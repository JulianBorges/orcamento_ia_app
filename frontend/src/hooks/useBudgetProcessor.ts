import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { excelRowSchema } from '../schemas/budgetSchema';
import { BudgetItem, recalculateNumbers } from '../utils/budgetUtils';
import { useBudgetStore } from '../store/useBudgetStore';
import { fromZodError } from "zod-validation-error";

export const useBudgetProcessor = () => {
    const { tableData, setTableData, setIsProcessing, setUploadProgress, setProcessingStatusText, setProcessedItemsCount } = useBudgetStore();
    const [pendingFlatRows, setPendingFlatRows] = useState<any[]>([]);
    const [showFlatListModal, setShowFlatListModal] = useState(false);
    
    const pendingVisualUpdates = useRef<any[]>([]);
    const [isPaused, setIsPaused] = useState(false);
    const isPausedRef = useRef(false);

    const togglePause = () => {
        setIsPaused(prev => {
            const next = !prev;
            isPausedRef.current = next;
            return next;
        });
    };

    // Efeito Dominó (Fila Global) - Movido para cá
    useEffect(() => {
        const interval = setInterval(() => {
            if (pendingVisualUpdates.current.length > 0) {
                const nextUpdate = pendingVisualUpdates.current.shift();
                setTableData(prev => prev.map(oldItem => 
                    oldItem.id === nextUpdate.id ? nextUpdate : oldItem
                ));
            }
        }, 100);
        return () => clearInterval(interval);
    }, [setTableData]);

    const startBatchProcessing = async (rows: any[], append: boolean) => {
        setIsProcessing(true);
        setUploadProgress(0);
        setProcessedItemsCount(0);
        setProcessingStatusText('Preparando lote para envio...');
        
        const initialItems: BudgetItem[] = rows.map((r) => ({
             id: r.id,
             item: r.item || "-",
             codigo: r.codigo || '-',
             base: r.base || '-',
             descricao: r.descricao,
             descricao_legada: r.descricao_legada || r.descricao,
             und: r.unidade || r.und || '-',
             quant: r.quantidade ?? r.quant ?? 1.0,
             valorUnit: r.valorUnit || 0.0,
             total: (r.valorUnit || 0.0) * (r.quantidade ?? r.quant ?? 1.0),
             is_macro_item: r.is_macro_item,
             macro_etapa_pai: r.macro_etapa_pai,
             ai_status: r.ai_status || (r.is_macro_item ? '-' : 'PROCESSANDO'),
             ai_justificativa: r.ai_justificativa || (r.is_macro_item ? '-' : 'Aguardando processamento em nuvem...')
        }));
        
        pendingVisualUpdates.current = [];
        
        const currentState = useBudgetStore.getState().tableData;
        let currentTableData = append ? [...currentState, ...initialItems] : initialItems;
        currentTableData = recalculateNumbers(currentTableData);
        
        // Efeito Cascata: Monta o esqueleto IMEDIATAMENTE na tela!
        setTableData(currentTableData);
        
        // Prepara itens válidos para IA (ignora macros)
        const validItems = rows.map(item => ({
            id: item.id,
            descricao: item.descricao,
            quantidade: item.quantidade,
            unidade: item.unidade,
            valorUnit: item.valorUnit,
            is_macro_item: item.is_macro_item,
            macro_etapa_pai: item.macro_etapa_pai
        }));
        
        setProcessingStatusText('Enviando lote de processamento (SSE)...');

        try {
            // Dispara o Job Unificado
            const res = await fetch(`/api/orcamento/processar-job`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "x-api-key": process.env.NEXT_PUBLIC_API_KEY || "chave-secreta-padrao"
                },
                body: JSON.stringify({ itens: validItems }),
            });
            
            if (!res.ok) throw new Error("Falha ao despachar Job");
            const data = await res.json();
            const jobId = data.job_id;
            
            setProcessingStatusText('Buscando itens no banco de dados e SINAPI...');
            let completed = 0;
            const totalItems = validItems.filter(i => !i.is_macro_item).length;

            // Inicia o túnel SSE
            const eventSource = new EventSource(`/api/orcamento/stream/${jobId}`);
            
            eventSource.onmessage = (event) => {
                const message = JSON.parse(event.data);
                
                if (message.type === 'item_processed') {
                    completed += 1;
                    setProcessedItemsCount(completed);
                    setUploadProgress(Math.min(100, Math.round((completed / totalItems) * 100)));
                    setProcessingStatusText(`Processando item ${completed} de ${totalItems}...`);
                    
                    const resultRow = message.data;
                    const resData = resultRow.resultado || {};
                    const analise = resData.analise || {};
                    const meta = resData.metadados || {};
                    const isApproved = analise.status?.includes('ACEITO');
                    const aiError = analise.erro || resData.erro || resultRow.erro;
                    const aiStatus = (analise.status || resData.status || resultRow.status || 'ERRO');
                    
                    // Encontra o item base correspondente
                    const oldItem = currentTableData.find(i => i.id === resultRow.id);
                    if (oldItem) {
                        const newItem = {
                            ...oldItem,
                            codigo: isApproved ? (meta.codigo || '-') : '-',
                            base: isApproved ? "SINAPI" : "-",
                            descricao: isApproved ? (meta.descricao || oldItem.descricao) : oldItem.descricao,
                            descricao_legada: oldItem.descricao_legada || oldItem.descricao,
                            und: isApproved ? (meta.unidade || '-') : '-',
                            valorUnit: isApproved ? (meta.custo || 0.0) : 0.0,
                            total: (isApproved ? (meta.custo || 0.0) : 0.0) * oldItem.quant,
                            ai_status: aiStatus,
                            ai_justificativa: analise.justificativa || resData.justificativa || aiError || 'Falha ao processar',
                            memoria_calculo: resData.memoria_calculo || []
                        };
                        
                        // Joga na fila do Efeito Dominó
                        pendingVisualUpdates.current.push(newItem);
                    }
                }
                
                if (message.type === 'job_completed') {
                    setProcessingStatusText('Calculando totais finais...');
                    setUploadProgress(100);
                    eventSource.close();
                    
                    setTimeout(() => {
                        setIsProcessing(false);
                        setUploadProgress(null);
                        setProcessingStatusText('');
                        setProcessedItemsCount(0);
                    }, 1500);
                }
            };
            
            eventSource.onerror = (error) => {
                console.error("SSE Error:", error);
                eventSource.close();
                setIsProcessing(false);
                setProcessingStatusText('Erro na conexão SSE');
            };

        } catch (error) {
            console.error("Erro no batch:", error);
            setIsProcessing(false);
            setProcessingStatusText('Falha ao iniciar processamento');
        }
    };

    const processFile = async (file: File, append: boolean) => {
        setIsProcessing(true);
        setUploadProgress(0);

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: "array" });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            
            let currentMacro = "";
            let temErros = false;
            
            const rows = jsonData.map((row: any, index: number) => {
                let descricao = "";
                let rawQuantidade = undefined;
                let quantidade = 1.0;
                let unidade = "";
                let rawValorUnit = undefined;
                let valorUnit = 0.0;
                
                for (const key of Object.keys(row)) {
                    const lowerKey = String(key).toLowerCase();
                    if (['descricao', 'descrição', 'servico', 'serviço', 'nome'].includes(lowerKey)) {
                        descricao = row[key];
                    }
                    else if (['quant', 'quantidade', 'qtd', 'qnt'].includes(lowerKey)) {
                        rawQuantidade = row[key];
                        quantidade = parseFloat(row[key]) || 1.0;
                    }
                    else if (['und', 'un', 'unidade', 'medida'].includes(lowerKey)) {
                        unidade = String(row[key]);
                    }
                    else if (['valor', 'preco', 'preço', 'unitario', 'unitário', 'custo'].includes(lowerKey)) {
                        rawValorUnit = row[key];
                        valorUnit = parseFloat(String(row[key]).replace(',', '.')) || 0.0;
                    }
                }
                
                if (!descricao) {
                    descricao = row[Object.keys(row)[0]] || "";
                }
                
                const isMissingQuant = rawQuantidade === undefined || String(rawQuantidade).trim() === "" || parseFloat(String(rawQuantidade)) === 0;
                const isMissingValor = rawValorUnit === undefined || String(rawValorUnit).trim() === "" || parseFloat(String(rawValorUnit).replace(',', '.')) === 0;
                const isMissingUnidade = unidade === undefined || String(unidade).trim() === "" || String(unidade).trim() === "-";
                const is_macro_item = (isMissingQuant && isMissingValor && isMissingUnidade) || String(row['Item'] || '').endsWith('.0');
                
                if (is_macro_item) {
                    currentMacro = String(descricao);
                }
                
                const parsed = excelRowSchema.safeParse({
                    descricao: String(descricao),
                    quantidade: is_macro_item ? 0.0 : (isNaN(quantidade) ? 1.0 : quantidade),
                    unidade: String(unidade),
                    valorUnit: is_macro_item ? 0.0 : (isNaN(valorUnit) ? 0.0 : valorUnit),
                    is_macro_item: is_macro_item,
                    macro_etapa_pai: is_macro_item ? "" : currentMacro
                });
                
                if (!parsed.success) {
                    temErros = true;
                    console.error("Zod Error:", fromZodError(parsed.error).message);
                }
                
                const validData = parsed.success ? parsed.data : {
                    descricao: `ERRO DE VALIDAÇÃO: ${fromZodError(parsed.error).message}`,
                    quantidade: 1.0,
                    unidade: "-",
                    valorUnit: 0.0,
                    is_macro_item: false,
                    macro_etapa_pai: ""
                };
                
                return {
                    id: `r_${Date.now()}_${index}`,
                    ...validData
                };
            });

            if (temErros) {
                alert("Foram detectados erros de validação Zod na sua planilha. Verifique o console.");
            }

            let macroCount = 0;
            rows.forEach(r => {
                if (r.is_macro_item) macroCount++;
            });

            if (macroCount === 0) {
                setPendingFlatRows(rows);
                setShowFlatListModal(true);
                setIsProcessing(false);
                setUploadProgress(null);
                return;
            }

            startBatchProcessing(rows, append);

        } catch (err) {
            console.error("Erro ao ler ou processar Excel:", err);
            setIsProcessing(false);
            setUploadProgress(null);
            alert("Ocorreu um erro ao processar o arquivo Excel.");
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, pendingFileRefCallback: (f: File) => void, showUploadDialogCallback: (b: boolean) => void, fileInputRef: React.RefObject<HTMLInputElement | null>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const currentState = useBudgetStore.getState().tableData;
        if (currentState.length > 0) {
            pendingFileRefCallback(file);
            showUploadDialogCallback(true);
        } else {
            processFile(file, false);
        }
        
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const generateEapWithAI = async () => {
        try {
            setIsProcessing(true);
            setUploadProgress(10);
            
            const payload = {
                itens: pendingFlatRows.map(r => ({ id: r.id, descricao: r.descricao }))
            };

            const res = await fetch(`/api/orcamento/estruturar-eap`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "x-api-key": process.env.NEXT_PUBLIC_API_KEY || "chave-secreta-padrao"
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error("Falha ao gerar EAP com a IA.");
            
            const data = await res.json();
            const etapas = data.data?.etapas || [];

            const newRows: any[] = [];
            
            etapas.forEach((etapa: any) => {
                const macroRow = {
                    id: `macro_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    descricao: etapa.nome,
                    quantidade: 0,
                    unidade: "-",
                    valorUnit: 0,
                    is_macro_item: true,
                    macro_etapa_pai: ""
                };
                newRows.push(macroRow);

                etapa.ids_servicos.forEach((id: string) => {
                    const originalItem = pendingFlatRows.find(r => r.id === id);
                    if (originalItem) {
                        newRows.push({
                            ...originalItem,
                            macro_etapa_pai: etapa.nome
                        });
                    }
                });
            });

            pendingFlatRows.forEach(originalItem => {
                if (!newRows.find(r => r.id === originalItem.id)) {
                    newRows.push({
                        ...originalItem,
                        macro_etapa_pai: "Itens Diversos"
                    });
                }
            });

            setShowFlatListModal(false);
            setPendingFlatRows([]);
            startBatchProcessing(newRows, false);

        } catch (error) {
            console.error(error);
            alert("Erro ao estruturar EAP. Tente novamente.");
            setIsProcessing(false);
            setUploadProgress(null);
        }
    };

    return {
        processFile,
        handleFileUpload,
        pendingFlatRows,
        setPendingFlatRows,
        showFlatListModal,
        setShowFlatListModal,
        isPaused,
        togglePause,
        generateEapWithAI,
        startBatchProcessing
    };
};

"use client";
import { useState, useRef, useMemo, useEffect } from "react";
import { UploadCloud, Loader2, Plus, Download, Trash2, AlertCircle, Sparkles } from "lucide-react";
import { BudgetTable, BudgetItem } from "@/components/BudgetTable";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CompositionCreatorModal, ComposicaoGerada } from "@/components/CompositionCreatorModal";
import * as XLSX from "xlsx";
import { z } from "zod";

const excelRowSchema = z.object({
  descricao: z.string().min(1, "Descrição vazia").default("Item sem descrição"),
  quantidade: z.number().default(1.0),
  unidade: z.string().default("-"),
  valorUnit: z.number().default(0.0),
});


export default function Home() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [title, setTitle] = useState("Orçamento Base");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showCreatorModal, setShowCreatorModal] = useState(false);
  const [creatorInitialQuery, setCreatorInitialQuery] = useState("");
  const [creatorTargetRowIndex, setCreatorTargetRowIndex] = useState<number | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [tableData, setTableData] = useState<BudgetItem[]>([]);
  const [bdi, setBdi] = useState(25.0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingVisualUpdates = useRef<any[]>([]);

  // Efeito Dominó (Fila Global)
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
  }, []);

  // Carregar do LocalStorage no Mount
  useEffect(() => {
    const saved = localStorage.getItem("orcamento_data");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.tableData) setTableData(parsed.tableData);
        if (parsed.bdi) setBdi(parsed.bdi);
        if (parsed.title) setTitle(parsed.title);
      } catch (e) {
        console.error("Erro ao carregar localStorage", e);
      }
    }
    setIsLoaded(true);
  }, []);

  // Salvar no LocalStorage sempre que alterar
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem("orcamento_data", JSON.stringify({ tableData, bdi, title }));
    }
  }, [tableData, bdi, title, isLoaded]);

  const totalComBdi = useMemo(() => {
      return tableData.reduce((acc, row) => {
          const quant = Number(row.quant) || 0;
          const valor = Number(row.valorUnit) || 0;
          const totalBase = quant * valor;
          return acc + (totalBase * (1 + bdi / 100));
      }, 0);
  }, [tableData, bdi]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (tableData.length > 0) {
      setPendingFile(file);
      setShowUploadDialog(true);
    } else {
      processFile(file, false);
    }
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const processFile = async (file: File, append: boolean) => {
    setIsProcessing(true);
    setUploadProgress(0);
    setShowUploadDialog(false);
    setPendingFile(null);

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        const rows = jsonData.map((row: any, index: number) => {
            let descricao = "";
            let quantidade = 1.0;
            let unidade = "";
            let valorUnit = 0.0;
            
            for (const key of Object.keys(row)) {
                const lowerKey = String(key).toLowerCase();
                if (['descricao', 'descrição', 'servico', 'serviço', 'nome'].includes(lowerKey)) {
                    descricao = row[key];
                }
                else if (['quant', 'quantidade', 'qtd', 'qnt'].includes(lowerKey)) {
                    quantidade = parseFloat(row[key]) || 1.0;
                }
                else if (['und', 'un', 'unidade', 'medida'].includes(lowerKey)) {
                    unidade = String(row[key]);
                }
                else if (['valor', 'preco', 'preço', 'unitario', 'unitário', 'custo'].includes(lowerKey)) {
                    valorUnit = parseFloat(String(row[key]).replace(',', '.')) || 0.0;
                }
            }
            if (!descricao) {
                // Fallback to first property if description is empty
                descricao = row[Object.keys(row)[0]] || "";
            }
            
            const parsed = excelRowSchema.safeParse({
                descricao: String(descricao),
                quantidade: isNaN(quantidade) ? 1.0 : quantidade,
                unidade: String(unidade),
                valorUnit: isNaN(valorUnit) ? 0.0 : valorUnit
            });
            
            const validData = parsed.success ? parsed.data : {
                descricao: "Item inválido detectado pelo Zod",
                quantidade: 1.0,
                unidade: "-",
                valorUnit: 0.0
            };
            
            return {
                id: `r_${Date.now()}_${index}`,
                ...validData
            };
        });

        // Atualiza a tabela imediatamente com os itens "PENDENTE"
        const startIndex = append ? tableData.length : 0;
        const initialItems: BudgetItem[] = rows.map((r, i) => ({
             id: r.id,
             item: `1.${startIndex + i + 1}`,
             codigo: '-',
             base: '-',
             descricao: r.descricao,
             descricao_legada: r.descricao,
             und: r.unidade || '-',
             quant: r.quantidade,
             valorUnit: r.valorUnit || 0.0,
             total: (r.valorUnit || 0.0) * r.quantidade,
             ai_status: 'PROCESSANDO',
             ai_justificativa: 'Analisando via IA...'
        }));
        
        // Limpa a fila do efeito dominó caso inicie novo lote
        pendingVisualUpdates.current = [];
        
        // Atualiza o estado da tabela sincronicamente antes de iniciar o loop assíncrono
        let currentTableData = append ? [...tableData, ...initialItems] : initialItems;
        setTableData(currentTableData);
        
        // Chunker (Lotes de 50 para máxima velocidade)
        const chunkSize = 50;
        let completed = 0;
        
        for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize).map(item => ({
                id: item.id,
                descricao: item.descricao,
                quantidade: item.quantidade,
                unidade: item.unidade,
                valorUnit: item.valorUnit
            }));
            let retries = 3;
            let success = false;
            
            while (retries > 0 && !success) {
                try {
                    const res = await fetch(`/api/orcamento/processar-lote-stateless`, {
                        method: "POST",
                        headers: { 
                            "Content-Type": "application/json",
                            "x-api-key": process.env.NEXT_PUBLIC_API_KEY || "chave-secreta-padrao"
                        },
                        body: JSON.stringify({ itens: chunk }),
                    });
                    
                    if (!res.ok) throw new Error("Erro na API");
                    
                    const responseData = await res.json();
                    
                    if (responseData.resultados) {
                        const updatedItemsMap = new Map();
                        
                        currentTableData = currentTableData.map(oldItem => {
                            const resultRow = responseData.resultados.find((r: any) => r.id === oldItem.id);
                            if (!resultRow) return oldItem;
                            
                            const resData = resultRow.resultado || {};
                            const analise = resData.analise || {};
                            const meta = resData.metadados || {};
                            const isApproved = analise.status?.includes('ACEITO');
                            const aiError = analise.erro || resData.erro || resultRow.erro;
                            const aiStatus = analise.status || resultRow.status || 'ERRO';
                            
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
                            
                            updatedItemsMap.set(newItem.id, newItem);
                            return newItem;
                        });
                        
                        // Joga na fila global para o Efeito Domino (3s por item)
                        pendingVisualUpdates.current.push(...Array.from(updatedItemsMap.values()));
                    }
                    success = true;
                } catch (err) {
                    retries--;
                    if (retries === 0) {
                        // Marca lote como erro
                        currentTableData = currentTableData.map(oldItem => {
                             if (chunk.some(c => c.id === oldItem.id)) {
                                 return { ...oldItem, ai_status: 'ERRO', ai_justificativa: 'Falha de conexão com a API' };
                             }
                             return oldItem;
                        });
                        setTableData([...currentTableData]);
                    } else {
                        // Espera exponencial antes do retry para desafogar o servidor (3s, 6s)
                        await new Promise(resolve => setTimeout(resolve, (4 - retries) * 3000));
                    }
                }
            }
            
            completed += chunk.length;
            setUploadProgress(Math.min(100, Math.round((completed / rows.length) * 100)));
        }
        
        setTimeout(() => {
            setIsProcessing(false);
            setUploadProgress(null);
        }, 1000);
        
    } catch (err) {
        console.error("Erro ao ler ou processar Excel:", err);
        setIsProcessing(false);
        setUploadProgress(null);
        alert("Ocorreu um erro ao processar o arquivo Excel.");
    }
  };

  const clearBudget = () => {
      if (window.confirm("Tem certeza que deseja limpar todo o orçamento? Esta ação não pode ser desfeita.")) {
          setTableData([]);
          setTitle("Orçamento Base");
          setBdi(25.0);
          pendingVisualUpdates.current = [];
          if (fileInputRef.current) fileInputRef.current.value = "";
      }
  };

  const downloadExcel = () => {
      if (tableData.length === 0) return;
      
      const exportData = tableData.map(row => ({
          "Item": row.item,
          "Código": row.codigo,
          "Base": row.base,
          "Descrição": row.descricao || '',
          "Und": row.und,
          "Quant": Number(row.quant),
          "Valor Unit": Number(row.valorUnit),
          "Valor c/ BDI": Number((row.valorUnit * (1 + bdi/100)).toFixed(2)),
          "Total": Number(((row.valorUnit * (1 + bdi/100)) * row.quant).toFixed(2)),
          "Parecer IA": row.ai_status || '',
          "Justificativa IA": row.ai_justificativa || ''
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Orçamento");
      
      XLSX.writeFile(workbook, `${title.replace(/\s+/g, '_')}_${new Date().getTime()}.xlsx`);
  };

  const handleAddCustomComposition = (composicao: ComposicaoGerada, originalQuery: string) => {
      const newItem: BudgetItem = {
          id: creatorTargetRowIndex !== null ? tableData[creatorTargetRowIndex].id : `r_${Date.now()}_custom`,
          item: creatorTargetRowIndex !== null ? tableData[creatorTargetRowIndex].item : `1.${tableData.length + 1}`,
          codigo: 'IA CUSTOM',
          base: 'IA CUSTOM',
          descricao: composicao.servico,
          und: composicao.unidade_medida,
          quant: creatorTargetRowIndex !== null ? tableData[creatorTargetRowIndex].quant : 1.0,
          valorUnit: composicao.valor_total_composicao,
          total: composicao.valor_total_composicao * (creatorTargetRowIndex !== null ? tableData[creatorTargetRowIndex].quant : 1.0),
          ai_status: 'ACEITO',
          ai_justificativa: `Composição Inédita Gerada por IA baseada na requisição: "${originalQuery}".\n\nAuditoria: ${composicao.justificativa}`
      };

      if (creatorTargetRowIndex !== null) {
          // Substituir linha existente
          const newData = [...tableData];
          newData[creatorTargetRowIndex] = newItem;
          setTableData(newData);
      } else {
          // Adicionar no final
          setTableData([...tableData, newItem]);
      }
      setCreatorTargetRowIndex(null);
  };

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Header Minimalista */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="w-full max-w-[1600px] mx-auto px-4 xl:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Copiloto <span className="text-zinc-400 dark:text-zinc-500 font-light">Orçamento</span></span>
          </div>
          <div className="flex items-center gap-4">
              <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="w-full max-w-[1600px] mx-auto px-4 xl:px-6 py-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-8">
          <div className="flex-1">
            <input 
                type="text" 
                value={title} 
                onChange={e => setTitle(e.target.value)}
                className="text-2xl font-semibold tracking-tight bg-transparent outline-none border-none focus:ring-0 w-full max-w-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-600 truncate"
                placeholder="Nome do Orçamento..."
            />
            <p className="text-sm text-zinc-400 dark:text-zinc-500 dark:text-zinc-400 mt-1">Gerencie itens, insumos e composições com IA.</p>
          </div>
          
          <div className="flex items-center gap-6">
              {tableData.length > 0 && (
                  <div className="flex items-center gap-6 mr-4 bg-white dark:bg-zinc-800 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
                      <div className="flex flex-col">
                          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 dark:text-zinc-400 mb-0.5">BDI (%)</span>
                          <div className="flex items-center gap-1 bg-transparent rounded px-2 py-1 focus-within:ring-2 focus-within:ring-indigo-500/50">
                              <input 
                                  type="number" 
                                  value={bdi} 
                                  onChange={e => setBdi(parseFloat(e.target.value) || 0)}
                                  className="w-14 bg-transparent text-sm font-medium text-zinc-700 dark:text-zinc-300 outline-none text-center"
                                  step="0.1"
                              />
                              <span className="text-xs text-zinc-400 dark:text-zinc-500">%</span>
                          </div>
                      </div>
                      <div className="w-px h-8 bg-zinc-100 dark:bg-zinc-800"></div>
                      <div className="flex flex-col">
                          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">Total do Orçamento (c/ BDI)</span>
                          <span className="text-2xl font-bold text-emerald-400 tracking-tight">
                              {totalComBdi.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                      </div>
                  </div>
              )}

              {uploadProgress !== null && (
                  <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-full px-4 py-1.5 shadow-inner">
                      <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                      <div className="w-32 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 transition-all duration-300 ease-out" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                      <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500 dark:text-zinc-400 font-mono">{uploadProgress}%</span>
                  </div>
              )}
              
              <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />
              
              {tableData.length === 0 && (
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-medium rounded-md transition-colors disabled:opacity-50 shadow-sm"
                  >
                    <UploadCloud className="w-4 h-4" /> Importar Excel
                  </button>
              )}
            </div>
        </div>

        {/* Tabela Wrapper */}
        <div className="w-full mt-6 flex-1 h-full">
          <BudgetTable 
              data={tableData} 
              setData={setTableData} 
              bdi={bdi} 
              onOpenCreatorModal={(q, rowIndex) => {
                  setCreatorInitialQuery(q);
                  setCreatorTargetRowIndex(rowIndex ?? null);
                  setShowCreatorModal(true);
              }}
          />
        </div>

        {/* Footer Actions */}
        {tableData.length > 0 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessing}
                        className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-800 hover:bg-zinc-  dark:hover:bg-zinc-800  text-zinc-700 dark:text-zinc-300 text-sm font-medium rounded-md transition-colors disabled:opacity-50 shadow-sm"
                    >
                        <Plus className="w-4 h-4" /> Carregar Mais Itens
                    </button>
                    <button 
                        onClick={clearBudget}
                        disabled={isProcessing}
                        className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-md transition-colors disabled:opacity-50"
                    >
                        <Trash2 className="w-4 h-4" /> Limpar Orçamento
                    </button>
                </div>
                
                <button 
                    onClick={downloadExcel}
                    disabled={isProcessing}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-md transition-colors shadow-lg disabled:opacity-50"
                >
                    <Download className="w-4 h-4" /> Download
                </button>
            </div>
        )}

        {/* Modal de Confirmação de Upload */}
        {showUploadDialog && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="bg-white dark:bg-[#18181b] border border-zinc-300 dark:border-zinc-700 p-6 rounded-xl shadow-2xl max-w-md w-full">
                    <div className="flex items-center gap-3 text-zinc-900 dark:text-zinc-100 mb-4">
                        <AlertCircle className="w-6 h-6 text-indigo-400" />
                        <h2 className="text-xl font-semibold">Planilha Detectada</h2>
                    </div>
                    <p className="text-zinc-400 dark:text-zinc-500 dark:text-zinc-400 text-sm mb-6">
                        Você já possui itens no orçamento atual. Deseja substituir tudo pela nova planilha ou acrescentar os novos itens ao final da lista?
                    </p>
                    <div className="flex items-center gap-3 justify-end">
                        <button 
                            onClick={() => setShowUploadDialog(false)}
                            className="px-4 py-2 text-sm font-medium text-zinc-400 dark:text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:text-zinc-200 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={() => pendingFile && processFile(pendingFile, false)}
                            className="px-4 py-2 text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-md transition-colors"
                        >
                            Sobrepor Tudo
                        </button>
                        <button 
                            onClick={() => pendingFile && processFile(pendingFile, true)}
                            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors shadow-lg"
                        >
                            Acrescentar ao Final
                        </button>
                    </div>
                </div>
            </div>
        )}

        <CompositionCreatorModal 
            isOpen={showCreatorModal}
            initialQuery={creatorInitialQuery}
            onClose={() => setShowCreatorModal(false)}
            onAddComposition={handleAddCustomComposition}
        />
      </main>
    </div>
  );
}

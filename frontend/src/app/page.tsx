"use client";
import { useState, useRef, useMemo, useEffect } from "react";
import { UploadCloud, Loader2, Settings, Plus, Download, Trash2, AlertCircle } from "lucide-react";
import { BudgetTable, BudgetItem } from "@/components/BudgetTable";

export default function Home() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [title, setTitle] = useState("Orçamento Base");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [tableData, setTableData] = useState<BudgetItem[]>([]);
  const [bdi, setBdi] = useState(25.0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    const formData = new FormData();
    formData.append("file", file);

    try {
        // Usa o Proxy do Next.js (/api) que redireciona automaticamente para o backend Python (sem problemas de CORS)
        const res = await fetch(`/api/orcamento/upload-lote`, {
            method: "POST",
            body: formData,
        });
        
        if (!res.ok) {
            alert("O servidor backend parece estar indisponível ou reiniciando. Tente novamente em alguns segundos.");
            setIsProcessing(false);
            setUploadProgress(null);
            return;
        }
        
        const data = await res.json();
        
        if (data.job_id) {
            // Smart Polling: Verifica o progresso a cada 3 segundos sem travar a conexão (Imune ao timeout da Vercel)
            const pollInterval = setInterval(async () => {
                try {
                    const progressRes = await fetch(`/api/orcamento/job/${data.job_id}/progress`);
                    if (!progressRes.ok) {
                        console.error("Falha ao buscar progresso. Status:", progressRes.status);
                        // Tenta novamente no próximo tick caso seja uma oscilação rápida de rede
                        return;
                    }
                    
                    const progressData = await progressRes.json();
                    
                    setUploadProgress(progressData.progress);
                    
                    if (progressData.status === "FINALIZADO" || progressData.status === "ERRO") {
                        clearInterval(pollInterval);
                        
                        // Busca os resultados reais gerados pela Inteligência Artificial
                        const resultRes = await fetch(`/api/orcamento/job/${data.job_id}/resultados`);
                        if (!resultRes.ok) {
                            console.error("Falha ao buscar resultados. Status:", resultRes.status);
                            setIsProcessing(false);
                            setUploadProgress(null);
                            return;
                        }
                        
                        const resultData = await resultRes.json();
                        
                        if (resultData.resultados) {
                            // Converte os resultados do backend pro formato da Tabela
                            const parsedData: BudgetItem[] = resultData.resultados.map((r: any, idx: number) => {
                                 const res = r?.resultado || {};
                                 const analise = res.analise || {};
                                 const meta = res.metadados || {};
                                 const isApproved = analise.status?.includes('ACEITO');
                                 const aiError = analise.erro || res.erro || r?.erro;
                                 
                                 return {
                                     id: String(idx),
                                     item: `1.${idx+1}`,
                                     codigo: isApproved ? (meta.codigo || '-') : '-',
                                     base: isApproved ? "SINAPI" : "-",
                                     descricao: isApproved ? (meta.descricao || res.descricao_original) : res.descricao_original,
                                     und: isApproved ? (meta.unidade || '-') : '-',
                                     quant: res.quantidade_original || 1, 
                                     valorUnit: isApproved ? (meta.custo || 0.0) : 0.0,
                                     total: (isApproved ? (meta.custo || 0.0) : 0.0) * (res.quantidade_original || 1),
                                     ai_status: analise.status || res.status || 'ERRO',
                                     ai_justificativa: analise.justificativa || res.justificativa || aiError || 'Falha ao processar'
                                 };
                            });
                            setTableData(prev => {
                                // Ajusta IDs se for append para evitar duplicação
                                const finalData = append ? [...prev] : [];
                                const startIndex = finalData.length;
                                const parsedWithUniqueIds = parsedData.map((r: BudgetItem, i: number) => ({
                                    ...r,
                                    id: `r_${Date.now()}_${startIndex + i}`,
                                    item: `1.${startIndex + i + 1}`
                                }));
                                return [...finalData, ...parsedWithUniqueIds];
                            });
                        }
                        
                        setTimeout(() => {
                            setIsProcessing(false);
                            setUploadProgress(null);
                        }, 500);
                    }
                } catch (err) {
                    console.error("Erro durante o Polling:", err);
                    // Não damos clearInterval aqui para que a rede tenha a chance de se recuperar em oscilações locais
                }
            }, 3000); // Poll a cada 3 segundos
        }
    } catch (err) {
        console.error(err);
        setIsProcessing(false);
        setUploadProgress(null);
    }
  };

  const clearBudget = () => {
      if (confirm("Tem certeza que deseja limpar todo o orçamento? Esta ação não pode ser desfeita.")) {
          setTableData([]);
          setTitle("Orçamento Base");
          setBdi(25.0);
      }
  };

  const downloadCSV = () => {
      if (tableData.length === 0) return;
      
      const headers = ["Item", "Código", "Base", "Descrição", "Und", "Quant", "Valor Unit", "Valor c/ BDI", "Total", "Parecer IA"];
      const rows = tableData.map(row => [
          row.item,
          row.codigo,
          row.base,
          `"${(row.descricao || '').replace(/"/g, '""')}"`,
          row.und,
          row.quant,
          row.valorUnit,
          (row.valorUnit * (1 + bdi/100)).toFixed(2),
          ((row.valorUnit * (1 + bdi/100)) * row.quant).toFixed(2),
          row.ai_status || ''
      ].join(","));
      
      const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(","), ...rows].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `${title.replace(/\s+/g, '_')}_${new Date().getTime()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Header Minimalista */}
      <header className="border-b border-zinc-800 bg-[#09090b]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="w-full max-w-[1600px] mx-auto px-4 xl:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight text-zinc-100">Copiloto <span className="text-zinc-500 font-light">Orçamento</span></span>
          </div>
          <button className="p-2 rounded-md hover:bg-zinc-800 text-zinc-400 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
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
                className="text-2xl font-semibold tracking-tight bg-transparent outline-none border-none focus:ring-0 w-full max-w-lg text-zinc-100 placeholder:text-zinc-600 truncate"
                placeholder="Nome do Orçamento..."
            />
            <p className="text-sm text-zinc-400 mt-1">Gerencie itens, insumos e composições com IA.</p>
          </div>
          
          <div className="flex items-center gap-6">
              {tableData.length > 0 && (
                  <div className="flex items-center gap-6 mr-4 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800/50 shadow-inner">
                      <div className="flex flex-col">
                          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-0.5">BDI (%)</span>
                          <div className="flex items-center gap-1 bg-zinc-800 rounded px-2 py-1 focus-within:ring-2 focus-within:ring-indigo-500/50">
                              <input 
                                  type="number" 
                                  value={bdi} 
                                  onChange={e => setBdi(parseFloat(e.target.value) || 0)}
                                  className="w-14 bg-transparent text-sm font-medium text-zinc-300 outline-none"
                                  step="0.1"
                              />
                              <span className="text-xs text-zinc-500">%</span>
                          </div>
                      </div>
                      <div className="w-px h-8 bg-zinc-800"></div>
                      <div className="flex flex-col">
                          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-0.5">Total do Orçamento (c/ BDI)</span>
                          <span className="text-2xl font-bold text-emerald-400 tracking-tight">
                              {totalComBdi.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                      </div>
                  </div>
              )}

              {uploadProgress !== null && (
                  <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-1.5 shadow-inner">
                      <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                      <div className="w-32 h-2 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 transition-all duration-300 ease-out" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                      <span className="text-xs font-medium text-zinc-400 font-mono">{uploadProgress}%</span>
                  </div>
              )}
              
              <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />
              
              {tableData.length === 0 && (
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-medium rounded-md transition-colors disabled:opacity-50 shadow-lg"
                  >
                    <UploadCloud className="w-4 h-4" /> Importar Excel
                  </button>
              )}
            </div>
        </div>

        {/* Tabela Wrapper */}
        <div className="w-full mt-6 flex-1 h-full">
          <BudgetTable data={tableData} setData={setTableData} bdi={bdi} />
        </div>

        {/* Footer Actions */}
        {tableData.length > 0 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-800">
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessing}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-md transition-colors disabled:opacity-50"
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
                    onClick={downloadCSV}
                    disabled={isProcessing}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-md transition-colors shadow-lg disabled:opacity-50"
                >
                    <Download className="w-4 h-4" /> Download CSV
                </button>
            </div>
        )}

        {/* Modal de Confirmação de Upload */}
        {showUploadDialog && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="bg-[#18181b] border border-zinc-700 p-6 rounded-xl shadow-2xl max-w-md w-full">
                    <div className="flex items-center gap-3 text-zinc-100 mb-4">
                        <AlertCircle className="w-6 h-6 text-indigo-400" />
                        <h2 className="text-xl font-semibold">Planilha Detectada</h2>
                    </div>
                    <p className="text-zinc-400 text-sm mb-6">
                        Você já possui itens no orçamento atual. Deseja substituir tudo pela nova planilha ou acrescentar os novos itens ao final da lista?
                    </p>
                    <div className="flex items-center gap-3 justify-end">
                        <button 
                            onClick={() => setShowUploadDialog(false)}
                            className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
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
      </main>
    </div>
  );
}

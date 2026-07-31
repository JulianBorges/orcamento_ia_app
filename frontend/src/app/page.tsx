"use client";
import { useState, useRef, useMemo, useEffect } from "react";
import { UploadCloud, Loader2, Plus, Download, Trash2, AlertCircle, Sparkles, Pause, Play } from "lucide-react";
import { BudgetTable } from "@/components/BudgetTable";
import { BudgetItem, recalculateNumbers } from "@/utils/budgetUtils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CompositionCreatorModal, ComposicaoGerada } from "@/components/CompositionCreatorModal";
import * as XLSX from "xlsx";
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { z } from "zod";
import { useBudgetStore } from "@/store/useBudgetStore";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useBudgetProcessor } from "@/hooks/useBudgetProcessor";


export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showCreatorModal, setShowCreatorModal] = useState(false);
  const [creatorInitialQuery, setCreatorInitialQuery] = useState("");
  const [creatorTargetRowIndex, setCreatorTargetRowIndex] = useState<number | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const {
    tableData, bdi, title, isProcessing, uploadProgress,
    setTableData, setBdi, setTitle, setIsProcessing, setUploadProgress, clearBudget
  } = useBudgetStore();

  const { saveStatus } = useAutoSave(tableData, title);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
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
  } = useBudgetProcessor();

  useEffect(() => {
    setIsMounted(true);
    if (sessionStorage.getItem("orcia_auth") === "true") {
        setIsAuthenticated(true);
    }
  }, []);

  const totalComBdi = useMemo(() => {
      return tableData.reduce((acc, row) => {
          const quant = Number(row.quant) || 0;
          const valor = Number(row.valorUnit) || 0;
          const totalBase = quant * valor;
          return acc + (totalBase * (1 + bdi / 100));
      }, 0);
  }, [tableData, bdi]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === (process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "admin123")) {
      setIsAuthenticated(true);
      sessionStorage.setItem("orcia_auth", "true");
    } else {
      alert("Senha incorreta!");
    }
  };



  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFileUpload(e, setPendingFile, setShowUploadDialog, fileInputRef);
  };

  const handleClearBudget = () => {
      if (window.confirm("Tem certeza que deseja limpar todo o orçamento? Esta ação não pode ser desfeita.")) {
          clearBudget();
          if (fileInputRef.current) fileInputRef.current.value = "";
      }
  };

  const downloadExcel = async () => {
      if (tableData.length === 0) return;
      
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Orçamento');
      
      // Cabeçalhos
      const headers = [
          { header: 'Item', key: 'item', width: 10 },
          { header: 'Código', key: 'codigo', width: 15 },
          { header: 'Base', key: 'base', width: 12 },
          { header: 'Descrição', key: 'descricao', width: 50 },
          { header: 'Und', key: 'und', width: 8 },
          { header: 'Quant', key: 'quant', width: 12 },
          { header: 'Valor Unit', key: 'valorUnit', width: 15 },
          { header: 'Valor c/ BDI', key: 'valorBdi', width: 15 },
          { header: 'Total', key: 'total', width: 15 },
          { header: 'Parecer IA', key: 'parecer', width: 15 },
          { header: 'Justificativa IA', key: 'justificativa', width: 40 }
      ];
      worksheet.columns = headers;
      
      // Estilo do cabeçalho
      worksheet.getRow(1).font = { bold: true };
      
      // Preenchendo linhas
      tableData.forEach((row, index) => {
          const rowData = {
              item: row.item,
              codigo: row.is_macro_item ? '' : row.codigo,
              base: row.is_macro_item ? '' : row.base,
              descricao: row.descricao || '',
              und: row.is_macro_item ? '' : row.und,
              quant: row.is_macro_item ? '' : Number(row.quant),
              valorUnit: row.is_macro_item ? '' : Number(row.valorUnit),
              valorBdi: row.is_macro_item ? '' : Number((row.valorUnit * (1 + bdi/100)).toFixed(2)),
              total: Number(row.total.toFixed(2)),
              parecer: row.is_macro_item ? '' : (row.ai_status || ''),
              justificativa: row.is_macro_item ? '' : (row.ai_justificativa || '')
          };
          
          const addedRow = worksheet.addRow(rowData);
          
          // Se for macro-etapa, aplica negrito na linha inteira
          if (row.is_macro_item) {
              addedRow.font = { bold: true };
          }
      });
      
      // Gerando buffer e baixando
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `${title.replace(/\s+/g, '_')}_${new Date().getTime()}.xlsx`);
  };

  const handleAddCustomComposition = (composicao: ComposicaoGerada, originalQuery: string) => {
      const cpCount = tableData.filter(i => i.base === 'CP' || i.codigo.startsWith('CP_')).length + 1;
      const cpCode = `CP_${cpCount.toString().padStart(2, '0')}`;

      const newItem: BudgetItem = {
          id: creatorTargetRowIndex !== null ? tableData[creatorTargetRowIndex].id : `r_${Date.now()}_custom`,
          item: creatorTargetRowIndex !== null ? tableData[creatorTargetRowIndex].item : `1.${tableData.length + 1}`,
          codigo: cpCode,
          base: 'CP',
          descricao: composicao.servico,
          und: composicao.unidade_medida,
          quant: creatorTargetRowIndex !== null ? tableData[creatorTargetRowIndex].quant : 1.0,
          valorUnit: composicao.valor_total_composicao,
          total: composicao.valor_total_composicao * (creatorTargetRowIndex !== null ? tableData[creatorTargetRowIndex].quant : 1.0),
          ai_status: creatorTargetRowIndex !== null ? 'SUBSTITUIDO' : 'SUBSTITUIDO', // Força SUBSTITUIDO para aparecer na cor certa e ativar o card de justificativa na interface
          ai_justificativa: `Composição Inédita Gerada por IA baseada na requisição: "${originalQuery}".\n\nParecer da IA: ${composicao.justificativa}`,
          composicao_detalhada: composicao.itens
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

  if (!isMounted) {
    return null; // Evita Hydration Mismatch
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-zinc-50 dark:bg-zinc-950 p-4">
        {/* Background Effects */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent"></div>
        
        <div className="max-w-[360px] w-full bg-white/40 dark:bg-zinc-900/40 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/20 dark:border-zinc-800/50 px-8 py-14 text-center space-y-8 relative z-10 group">
          <div className="mx-auto w-16 h-16 bg-gradient-to-tr from-indigo-600 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/30 transition-transform duration-700 group-hover:-translate-y-1">
            <Sparkles className="w-8 h-8 text-white transition-transform duration-1000 group-hover:rotate-[360deg]" />
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Faça o login</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Insira a senha master para acessar.</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-5">
            <input 
              type="password" 
              value={passwordInput} 
              onChange={e => setPasswordInput(e.target.value)} 
              className="w-full px-5 py-4 rounded-xl bg-white/50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 dark:text-zinc-100 text-center text-xl tracking-widest placeholder:tracking-normal outline-none transition-all"
              placeholder="••••••••"
              autoFocus
            />
            <button type="submit" className="w-full py-4 bg-zinc-900 hover:bg-zinc-800 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white rounded-xl font-semibold transition-all shadow-md hover:shadow-xl active:scale-[0.98]">
              Entrar
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Header Minimalista */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="w-full max-w-[1600px] mx-auto px-4 xl:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Copiloto <span className="text-zinc-400 dark:text-zinc-500 font-light">Orçamento</span></span>
            {saveStatus === 'saving' && <span className="ml-4 text-xs font-medium text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full animate-pulse">☁️ Salvando...</span>}
            {saveStatus === 'saved' && <span className="ml-4 text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-full">✅ Salvo</span>}
            {saveStatus === 'error' && <span className="ml-4 text-xs font-medium text-red-500 bg-red-500/10 px-2 py-1 rounded-full">⚠️ Erro ao Salvar</span>}
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
                      <button 
                          onClick={togglePause}
                          className="relative flex items-center justify-center w-6 h-6 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group focus:outline-none"
                          title={isPaused ? "Retomar Analise" : "Pausar Analise"}
                      >
                          {!isPaused && <Loader2 className="w-4 h-4 text-indigo-400 animate-spin group-hover:opacity-0 transition-opacity absolute" />}
                          {!isPaused && <Pause className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity absolute" />}
                          {isPaused && <Play className="w-3.5 h-3.5 text-emerald-500 absolute" />}
                      </button>
                      <div className="w-32 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                          <div className={`h-full transition-all duration-300 ease-out ${isPaused ? 'bg-zinc-400 dark:bg-zinc-600' : 'bg-indigo-500'}`} style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                      <span className={`text-xs font-medium font-mono ${isPaused ? 'text-zinc-400' : 'text-indigo-500 dark:text-indigo-400'}`}>{uploadProgress}%</span>
                  </div>
              )}
              
              <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={onFileInputChange} />
              
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
                        onClick={handleClearBudget}
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
                            onClick={() => {
                  if(pendingFile) {
                      setShowUploadDialog(false);
                      setPendingFile(null);
                      processFile(pendingFile, false);
                  }
                }}
                            className="px-4 py-2 text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-md transition-colors"
                        >
                            Sobrepor Tudo
                        </button>
                        <button 
                            onClick={() => {
                  if(pendingFile) {
                      setShowUploadDialog(false);
                      setPendingFile(null);
                      processFile(pendingFile, true);
                  }
                }}
                            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors shadow-lg"
                        >
                            Acrescentar ao Final
                        </button>
                    </div>
                </div>
            </div>
        )}

        {showFlatListModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="bg-white dark:bg-[#18181b] border border-zinc-300 dark:border-zinc-700 p-6 rounded-xl shadow-2xl max-w-md w-full">
                    <div className="flex items-center gap-3 text-zinc-900 dark:text-zinc-100 mb-4">
                        <AlertCircle className="w-6 h-6 text-amber-400" />
                        <h2 className="text-xl font-semibold">Lista Plana Detectada</h2>
                    </div>
                    <p className="text-zinc-400 dark:text-zinc-500 text-sm mb-6 leading-relaxed">
                        Não identificámos etapas estruturais (como 1.0, 2.0 ou cabeçalhos) na sua planilha. 
                        Deseja prosseguir assim mesmo ou usar a IA para estruturar uma EAP lógica automaticamente?
                    </p>
                    <div className="flex flex-col gap-3">
                        <button 
                            onClick={() => {
                                setShowFlatListModal(false);
                                startBatchProcessing(pendingFlatRows, false); // ou append
                            }}
                            className="w-full px-4 py-2 text-sm font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
                        >
                            Mapear como Lista Plana
                        </button>
                        <button 
                            onClick={async () => {
                                setShowFlatListModal(false);
                                generateEapWithAI();
                            }}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white rounded-md transition-colors shadow-lg"
                        >
                            <Sparkles className="w-4 h-4" />
                            Usar IA para Estruturar EAP
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

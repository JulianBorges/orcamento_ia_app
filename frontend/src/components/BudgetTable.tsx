"use client";
import React, { useState, useRef, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { 
    Plus, Trash2, Wand2, Box, Layers, Loader2, ArrowUpDown
} from "lucide-react";

export type BudgetItem = {
  id: string;
  item: string;
  codigo: string;
  base: string;
  descricao: string;
  und: string;
  quant: number;
  valorUnit: number;
  total: number;
  ai_status?: string;
  ai_justificativa?: string;
};

const columnHelper = createColumnHelper<BudgetItem>();

// Componente isolado para evitar perda de foco e lag durante a digitação
const CellInput = ({ initialValue, onUpdate, type = "text", className = "", step }: any) => {
    const [val, setVal] = useState(initialValue);
    
    // Atualiza o estado local se o valor pai mudar (ex: IA injeta novos dados)
    useEffect(() => {
        setVal(initialValue);
    }, [initialValue]);

    return (
        <input 
            type={type}
            step={step}
            value={val}
            onChange={e => setVal(e.target.value)}
            onBlur={() => onUpdate(type === 'number' ? (parseFloat(val) || 0) : val)}
            className={className}
        />
    );
};

// Componente inteligente que faz a ponte visual com o banco de dados vetorial
const AutocompleteDescricaoCell = ({ initialValue, rowIndex, onUpdateRow }: any) => {
    const [val, setVal] = useState(initialValue);
    const [results, setResults] = useState<any[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        setVal(initialValue);
    }, [initialValue]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                onUpdateRow({ descricao: val });
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef, val, onUpdateRow]);

    const handleSearch = async (query: string) => {
        if (!query || query.length < 3) {
            setResults([]);
            setIsOpen(false);
            return;
        }
        setIsLoading(true);
        try {
            const res = await fetch(`/api/sinapi/search?q=${encodeURIComponent(query)}`);
            if (res.ok) {
                const data = await res.json();
                setResults(data.results || []);
                setIsOpen(true);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const query = e.target.value;
        setVal(query);
        e.target.style.height = 'auto';
        e.target.style.height = e.target.scrollHeight + 'px';
        
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            handleSearch(query);
        }, 500);
    };

    const onSelect = (item: any) => {
        setVal(item.descricao);
        setIsOpen(false);
        // Auto-fill: Sobrescreve toda a linha com a opção escolhida
        onUpdateRow({
            codigo: item.codigo,
            base: "SINAPI",
            descricao: item.descricao,
            und: item.unidade || "-",
            valorUnit: Number(item.preco) || 0
        });
    };

    return (
        <div ref={wrapperRef} className="relative w-full h-full flex items-center">
            <div className="relative w-full">
                <textarea 
                    value={val}
                    onChange={onChange}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            onUpdateRow({ descricao: val });
                            setIsOpen(false);
                        }
                    }}
                    className="w-full bg-transparent text-zinc-300 outline-none focus:bg-zinc-800 px-1 py-1 rounded resize-none custom-scrollbar cursor-text block leading-tight"
                    rows={1}
                    style={{ minHeight: '24px', overflow: 'hidden' }}
                />
                {isLoading && <Loader2 className="absolute right-2 top-2 w-3 h-3 text-indigo-400 animate-spin" />}
            </div>
            
            {isOpen && results.length > 0 && (
                <div className="absolute left-0 top-full mt-1 w-[600px] z-[999] bg-[#18181b] border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col transform origin-top-left transition-all">
                    <div className="bg-zinc-800/50 px-3 py-1.5 border-b border-zinc-700 flex justify-between items-center">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 flex items-center gap-1"><Wand2 className="w-3 h-3"/> Sugestões da Inteligência</span>
                        <span className="text-[10px] text-zinc-500">{results.length} resultados no SINAPI</span>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar flex flex-col">
                        {results.map((r, i) => (
                            <div 
                                key={i}
                                onClick={() => onSelect(r)}
                                className="flex flex-col p-3 hover:bg-zinc-800/80 border-b border-zinc-800/50 cursor-pointer transition-colors group"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded">{r.codigo}</span>
                                        <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">R$ {Number(r.preco).toFixed(2)}</span>
                                        <span className="text-xs font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded shadow-sm">{r.unidade}</span>
                                    </div>
                                    <span className="text-[10px] text-zinc-500 group-hover:text-indigo-400 transition-colors">Match: {Math.round(Number(r.score) * 100)}%</span>
                                </div>
                                <span className="text-sm text-zinc-300 line-clamp-2 leading-relaxed">{r.descricao}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export function BudgetTable({ 
    data = [], 
    setData,
    bdi = 25 
}: { 
    data: BudgetItem[], 
    setData: React.Dispatch<React.SetStateAction<BudgetItem[]>>,
    bdi?: number 
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const updateData = React.useCallback((rowIndex: number, columnId: string, value: any) => {
      setData(old =>
        old.map((row, index) => {
          if (index === rowIndex) {
            const newRow = { ...row, [columnId]: value };
            if (columnId === 'quant' || columnId === 'valorUnit') {
                newRow.total = Number(newRow.quant) * Number(newRow.valorUnit);
            }
            return newRow;
          }
          return row;
        })
      )
  }, [setData]);

  // Permite substituir o conteúdo completo da linha (Auto-Fill do Autocomplete)
  const updateRow = React.useCallback((rowIndex: number, newRowData: Partial<BudgetItem>) => {
      setData(old =>
        old.map((row, index) => {
          if (index === rowIndex) {
            const newRow = { ...row, ...newRowData };
            // Força o recalculo do total se as variáveis financeiras mudaram
            if ('quant' in newRowData || 'valorUnit' in newRowData) {
                newRow.total = Number(newRow.quant) * Number(newRow.valorUnit);
            }
            // Força o recalculo caso a IA limpe o status por ser um Auto-Fill manual
            if ('codigo' in newRowData && !('ai_status' in newRowData)) {
                newRow.ai_status = 'APROVADO_MANUALMENTE';
                newRow.ai_justificativa = 'Item selecionado manualmente pelo Orçamentista no banco de dados.';
            }
            return newRow;
          }
          return row;
        })
      )
  }, [setData]);

  const columns = React.useMemo(() => [
    columnHelper.accessor("item", { 
        header: "Item", 
        size: 70,
        cell: info => <CellInput initialValue={info.getValue()} onUpdate={(v:any) => updateData(info.row.index, 'item', v)} className="w-full bg-transparent text-zinc-300 font-semibold outline-none focus:bg-zinc-800 px-1 rounded" />
    }),
    columnHelper.accessor("codigo", { 
        header: "Código", 
        size: 100,
        cell: info => <CellInput initialValue={info.getValue()} onUpdate={(v:any) => updateData(info.row.index, 'codigo', v)} className="w-full bg-transparent text-blue-400 outline-none focus:bg-zinc-800 px-1 rounded cursor-text" />
    }),
    columnHelper.accessor("base", { 
        header: "Base", 
        size: 80,
        cell: info => <CellInput initialValue={info.getValue()} onUpdate={(v:any) => updateData(info.row.index, 'base', v)} className="w-full bg-transparent text-zinc-300 outline-none focus:bg-zinc-800 px-1 rounded" />
    }),
    columnHelper.accessor("descricao", { 
        header: "Descrição do Serviço/Insumo",
        size: 600,
        cell: info => <AutocompleteDescricaoCell 
            initialValue={info.getValue()} 
            rowIndex={info.row.index}
            onUpdateRow={(newRowData: any) => updateRow(info.row.index, newRowData)}
        />
    }),
    columnHelper.accessor("ai_status", {
        header: "Parecer IA",
        size: 110,
        cell: info => {
            const status = info.getValue() || 'PENDENTE';
            const just = info.row.original.ai_justificativa || '';
            
            let color = "bg-zinc-800 text-zinc-400";
            if (status.includes("APROVADO")) color = "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
            else if (status.includes("REVISAO")) color = "bg-amber-500/10 text-amber-400 border border-amber-500/20";
            else if (status.includes("REJEITADO") || status.includes("ERRO") || status.includes("VAZIO")) color = "bg-red-500/10 text-red-400 border border-red-500/20";
            
            return (
                <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold w-max ${color} cursor-help truncate max-w-full`} title={just}>
                    {status.replace(/_/g, ' ')}
                </div>
            );
        }
    }),
    columnHelper.accessor("und", { 
        header: "Und", 
        size: 60,
        cell: info => <CellInput initialValue={info.getValue()} onUpdate={(v:any) => updateData(info.row.index, 'und', v)} className="w-full bg-transparent text-zinc-400 outline-none focus:bg-zinc-800 px-1 rounded text-center" />
    }),
    columnHelper.accessor("quant", { 
        header: "Quant.", 
        size: 90,
        cell: info => <CellInput type="number" step="0.01" initialValue={info.getValue()} onUpdate={(v:any) => updateData(info.row.index, 'quant', v)} className="w-full bg-transparent text-zinc-300 outline-none focus:bg-zinc-800 px-1 rounded text-right" />
    }),
    columnHelper.accessor("valorUnit", { 
        header: "Valor Unit", 
        size: 110,
        cell: info => <CellInput type="number" step="0.01" initialValue={info.getValue()} onUpdate={(v:any) => updateData(info.row.index, 'valorUnit', v)} className="w-full bg-transparent text-zinc-300 outline-none focus:bg-zinc-800 px-1 rounded text-right" />
    }),
    columnHelper.display({
        id: "valorUnitBdi",
        header: "Valor c/ BDI",
        size: 110,
        cell: info => {
            const val = info.row.original.valorUnit * (1 + bdi / 100);
            return <div className="text-right px-1 text-zinc-300 w-full">{val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>;
        }
    }),
    columnHelper.display({
        id: "totalBdi",
        header: "Total",
        size: 130,
        cell: info => {
            const val = (info.row.original.valorUnit * (1 + bdi / 100)) * info.row.original.quant;
            return <div className="text-right px-1 font-semibold text-zinc-200 w-full">{val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>;
        }
    })
  ], [bdi, updateData]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
    getRowId: row => row.id,
  });

  const { rows } = table.getRowModel();
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 44, // Altura reduzida
    overscan: 10,
  });

  // Pass updated data to parent implicitly? Actually Next.js state doesn't bubble automatically unless we pass a callback.
  // We can just rely on the table's internal state for now.

  if (data.length === 0) {
      return (
          <div className="w-full flex flex-col items-center justify-center py-20 bg-[#09090b] rounded-lg border border-zinc-800 border-dashed">
              <Layers className="w-12 h-12 text-zinc-700 mb-4" />
              <h3 className="text-lg font-medium text-zinc-300">Nenhum orçamento carregado</h3>
              <p className="text-zinc-500 text-sm mt-1 max-w-sm text-center">Faça o upload da sua planilha Excel para a Inteligência Artificial analisar.</p>
          </div>
      );
  }

  return (
    <div className="flex flex-col gap-4 w-full h-full">
        <div className="flex items-center justify-between text-sm text-zinc-400">
            <span>Orçamento com {data.length} itens</span>
        </div>

        <div 
            ref={tableContainerRef}
            className="w-full h-[65vh] overflow-auto bg-[#09090b] rounded-lg border border-zinc-800 shadow-xl custom-scrollbar"
        >
          <div className="w-full text-sm text-left flex flex-col min-w-max">
            {/* Header */}
            <div className="text-xs uppercase bg-[#18181b] text-zinc-400 border-b border-zinc-800 sticky top-0 z-20 shadow-sm flex select-none">
              <div className="w-12 shrink-0 bg-[#18181b]"></div>
              {table.getHeaderGroups().map((headerGroup) => (
                <div key={headerGroup.id} className="flex flex-1">
                  {headerGroup.headers.map((header) => (
                    <div 
                        key={header.id} 
                        style={{ width: header.getSize(), flexGrow: header.column.id === 'descricao' ? 1 : 0 }} 
                        className="px-3 py-2 font-medium flex items-center gap-1 shrink-0 relative group hover:bg-zinc-800/50 transition-colors cursor-pointer"
                        onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      
                      {{
                          asc: <ArrowUpDown className="w-3 h-3 text-indigo-400" />,
                          desc: <ArrowUpDown className="w-3 h-3 text-indigo-400 rotate-180" />,
                      }[header.column.getIsSorted() as string] ?? (
                          header.column.getCanSort() ? <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-30" /> : null
                      )}

                      <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={`absolute right-0 top-0 h-full w-1 bg-indigo-500/50 cursor-col-resize opacity-0 group-hover:opacity-100 ${
                              header.column.getIsResizing() ? 'opacity-100 bg-indigo-500' : ''
                          }`}
                          onClick={e => e.stopPropagation()}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            
            {/* Body */}
            <div 
                className="relative w-full flex flex-col divide-y divide-zinc-800/50"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                    <div 
                        key={row.id} 
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className="group hover:bg-zinc-800/30 transition-colors duration-150 absolute top-0 left-0 w-full flex items-center py-1 z-10 hover:z-[90]"
                        style={{
                            minHeight: '44px',
                            transform: `translateY(${virtualRow.start}px)`,
                        }}
                    >
                        <div className="w-12 relative p-0 m-0 shrink-0 flex items-center justify-center h-full">
                            {/* Ponte invisível para o mouse não perder o hover ao descer para o menu */}
                            <div className="absolute left-8 top-[60%] pt-2 pb-1 px-1 opacity-0 group-hover:opacity-100 transition-all duration-200 z-[70] scale-95 group-hover:scale-100 flex justify-center items-start">
                                <div className="flex flex-row items-center bg-black rounded-md shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] border border-zinc-700 p-1 gap-1 h-9">
                                
                                <button 
                                    onClick={() => alert("Composição detalhada")}
                                    className="flex flex-row items-center justify-center px-2 py-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-100 transition-colors gap-1.5 h-full">
                                    <Layers className="w-3 h-3" />
                                    <span className="text-[10px] font-medium whitespace-nowrap">Composição</span>
                                </button>

                                <button 
                                    onClick={() => alert("Trocar Insumo")}
                                    className="flex flex-row items-center justify-center px-2 py-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-100 transition-colors gap-1.5 h-full">
                                    <Box className="w-3 h-3" />
                                    <span className="text-[10px] font-medium whitespace-nowrap">Insumo</span>
                                </button>

                                <button 
                                    onClick={() => alert(`Agente IA vai processar!`)}
                                    className="flex flex-row items-center justify-center px-2 py-1 hover:bg-indigo-500/10 rounded text-indigo-400 hover:text-indigo-300 transition-colors gap-1.5 h-full">
                                    <Wand2 className="w-3 h-3" />
                                    <span className="text-[10px] font-medium whitespace-nowrap">Auto IA</span>
                                </button>

                                <button 
                                    onClick={() => {
                                        const newData = [...data];
                                        newData.splice(virtualRow.index + 1, 0, {id: Date.now().toString(), item: "Novo", codigo: "", base: "SINAPI", descricao: "", und: "-", quant: 1, valorUnit: 0, total: 0});
                                        setData(newData);
                                    }}
                                    className="flex flex-row items-center justify-center px-2 py-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-100 transition-colors gap-1.5 h-full">
                                    <Plus className="w-3 h-3" />
                                    <span className="text-[10px] font-medium whitespace-nowrap">Linha</span>
                                </button>
                                
                                <div className="w-px h-4 bg-zinc-700 mx-0.5"></div>

                                <button 
                                    onClick={() => setData(prev => prev.filter(item => item.id !== row.original.id))}
                                    className="flex flex-row items-center justify-center px-2 py-1 hover:bg-red-500/10 rounded text-red-400 hover:text-red-300 transition-colors gap-1.5 h-full">
                                    <Trash2 className="w-3 h-3" />
                                    <span className="text-[10px] font-medium whitespace-nowrap">Excluir</span>
                                </button>
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex flex-1 w-full">
                            {row.getVisibleCells().map((cell) => (
                                <div key={cell.id} style={{ width: cell.column.getSize(), flexGrow: cell.column.id === 'descricao' ? 1 : 0 }} className="px-3 shrink-0 flex items-center">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </div>
                            ))}
                        </div>
                    </div>
                );
              })}
            </div>
          </div>
        </div>
    </div>
  );
}

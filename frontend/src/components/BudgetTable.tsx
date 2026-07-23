"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
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
    Plus, Trash2, Wand2, Box, Layers, Loader2, ArrowUpDown, Brain, X, GripVertical, List, ChevronDown, ChevronRight, ChevronUp
} from "lucide-react";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useBudgetStore } from '@/store/useBudgetStore';
import { BudgetItem, recalculateNumbers, moveRowOrBlock } from '@/utils/budgetUtils';
import { CompositionDetailsModal } from "./CompositionDetailsModal";

const columnHelper = createColumnHelper<BudgetItem>();

// Componente isolado para evitar perda de foco e lag durante a digitação
export interface CellInputProps {
    initialValue: string | number;
    onUpdate: (val: string | number) => void;
    type?: string;
    className?: string;
    step?: string;
}

const CellInput = ({ initialValue, onUpdate, type = "text", className = "", step }: CellInputProps) => {
    const formatValue = (v: any) => {
        if (type === 'number') {
            const num = parseFloat(String(v).replace(',', '.'));
            return isNaN(num) ? "" : num.toFixed(2).replace('.', ',');
        }
        return v;
    };

    const [val, setVal] = useState(formatValue(initialValue));
    
    // Atualiza o estado local se o valor pai mudar (ex: IA injeta novos dados)
    useEffect(() => {
        setVal(formatValue(initialValue));
    }, [initialValue]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let newVal = e.target.value;
        if (type === 'number') {
            // Permitir apenas números, pontos e vírgulas durante a digitação
            newVal = newVal.replace(/[^0-9.,]/g, '');
        }
        setVal(newVal);
    };

    const handleBlur = () => {
        if (type === 'number') {
            // Pega o valor digitado, aceita ponto ou vírgula como separador decimal
            // Para evitar bugs com múltiplos pontos (ex: 1.000.50), convertemos a última vírgula em ponto, 
            // ou assumimos que o formato foi digitado cru
            let cleanStr = String(val).replace(',', '.');
            const parts = cleanStr.split('.');
            if (parts.length > 2) {
                cleanStr = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
            }
            const num = parseFloat(cleanStr);
            const finalNum = isNaN(num) ? 0 : num;
            
            onUpdate(finalNum);
            setVal(finalNum.toFixed(2).replace('.', ','));
        } else {
            onUpdate(val);
        }
    };

    return (
        <input 
            type={type === 'number' ? 'text' : type}
            inputMode={type === 'number' ? 'decimal' : undefined}
            step={step}
            value={val}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                    e.currentTarget.blur();
                }
            }}
            className={className}
        />
    );
};

export interface CodigoCellProps {
    initialValue: string;
    item: BudgetItem;
    onUpdate: (val: string) => void;
    onOpenDetails: (item: BudgetItem) => void;
}

const CodigoCell = ({ initialValue, item, onUpdate, onOpenDetails }: CodigoCellProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [val, setVal] = useState(initialValue);

    useEffect(() => { setVal(initialValue); }, [initialValue]);

    if (isEditing) {
        return (
            <input 
                type="text"
                value={val}
                autoFocus
                onChange={e => setVal(e.target.value)}
                onBlur={() => {
                    setIsEditing(false);
                    onUpdate(val);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                        e.currentTarget.blur();
                    }
                }}
                className="w-full bg-zinc-100 dark:bg-zinc-800 text-blue-400 outline-none px-1 rounded cursor-text"
            />
        );
    }

    return (
        <div 
            onDoubleClick={() => setIsEditing(true)}
            onClick={() => {
                if (!initialValue || initialValue === '-') return;
                onOpenDetails(item);
            }}
            className="w-full bg-transparent text-blue-400 px-1 rounded cursor-pointer hover:underline decoration-blue-500/50 underline-offset-4 truncate text-center"
            title="Clique para abrir, duplo clique para editar"
        >
            {initialValue || '-'}
        </div>
    );
};

// Componente inteligente que faz a ponte visual com o banco de dados vetorial
export interface AutocompleteDescricaoCellProps {
    initialValue: string;
    rowIndex: number;
    onUpdateRow: (row: Partial<BudgetItem>) => void;
    onOpenChange?: (isOpen: boolean) => void;
}

const AutocompleteDescricaoCell = ({ initialValue, rowIndex, onUpdateRow, onOpenChange }: AutocompleteDescricaoCellProps) => {
    const [val, setVal] = useState(initialValue);
    const [results, setResults] = useState<any[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    const adjustHeight = useCallback(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, []);

    // Sincroniza valor inicial
    useEffect(() => {
        setVal(initialValue);
    }, [initialValue]);

    // Ajusta a altura sempre que o valor mudar
    useEffect(() => {
        adjustHeight();
    }, [val, adjustHeight]);

    // Ajusta a altura sempre que a largura da coluna mudar (ex: resize manual)
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        
        const observer = new ResizeObserver(() => {
            adjustHeight();
        });
        
        observer.observe(el);
        return () => observer.disconnect();
    }, [adjustHeight]);

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

    useEffect(() => {
        if (onOpenChange) onOpenChange(isOpen);
    }, [isOpen, onOpenChange]);



    const handleSearch = async (query: string) => {
        if (!query || query.length < 3) {
            setResults([]);
            setIsOpen(false);
            return;
        }
        setIsLoading(true);
        try {
            const res = await fetch(`/api/sinapi/search?q=${encodeURIComponent(query)}`, {
                headers: {
                    "x-api-key": process.env.NEXT_PUBLIC_API_KEY || "chave-secreta-padrao"
                }
            });
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
            valorUnit: Number(item.preco) || 0,
            ai_status: "SUBSTITUIDO",
            ai_justificativa: "Item substituído manualmente pelo usuário."
        });
    };

    return (
        <div ref={wrapperRef} className="relative w-full h-full flex items-center">
            <div className="relative w-full">
                <textarea 
                    ref={textareaRef}
                    value={val}
                    onChange={onChange}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            onUpdateRow({ descricao: val });
                            setIsOpen(false);
                            textareaRef.current?.blur();
                        }
                        if (e.key === 'Escape') {
                            setIsOpen(false);
                            textareaRef.current?.blur();
                        }
                    }}
                    className="w-full bg-transparent text-zinc-700 dark:text-zinc-300 outline-none px-1 py-1 rounded resize-none cursor-text block leading-snug overflow-hidden"
                    rows={1}
                    style={{ minHeight: '32px' }}
                />
                {isLoading && <Loader2 className="absolute right-2 top-2 w-3 h-3 text-indigo-400 animate-spin" />}
            </div>
            
            {isOpen && results.length > 0 && (
                <div 
                    onMouseLeave={() => setIsOpen(false)}
                    className="absolute left-0 top-full mt-1 w-[600px] z-[999] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-2xl overflow-hidden flex flex-col transform origin-top-left transition-all"
                >
                    <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-3 py-1.5 flex justify-between items-center">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 dark:text-zinc-500 dark:text-zinc-400 flex items-center gap-1"><Wand2 className="w-3 h-3"/> Sugestões da Inteligência</span>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{results.length} resultados no SINAPI</span>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar flex flex-col">
                        {results.map((r, i) => (
                            <div 
                                key={i}
                                onClick={() => onSelect(r)}
                                className="flex flex-col p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-800/50 cursor-pointer transition-colors group"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded">{r.codigo}</span>
                                        <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">R$ {Number(r.preco).toFixed(2)}</span>
                                        <span className="text-xs font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded shadow-sm">{r.unidade}</span>
                                    </div>
                                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 group-hover:text-indigo-400 transition-colors">Match: {Math.round(Number(r.score) * 100)}%</span>
                                </div>
                                <span className="text-sm text-zinc-700 dark:text-zinc-300 line-clamp-2 leading-relaxed">{r.descricao}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const SortableRow = ({ row, virtualRow, data, setData, onOpenCreatorModal, rowVirtualizer, activeAutocompleteRowId }: any) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.original.id });
    
    const isAutocompleteOpen = activeAutocompleteRowId === row.original.id;
    
    const [isFocused, setIsFocused] = useState(false);

    // O transform do sortable (que move no eixo Y durante o arraste) é somado ao translateY da virtualização
    const style: React.CSSProperties = {
        minHeight: '52px',
        transform: transform 
            ? `translate3d(${transform.x}px, ${virtualRow.start + transform.y}px, 0)` 
            : `translateY(${virtualRow.start}px)`,
        transition: transition || undefined,
        // Força z-index alto quando o autocomplete está aberto ou quando a linha tem hover/focus, para não ser coberta por irmãos virtuais
        zIndex: isDragging ? 999 : (isAutocompleteOpen ? 900 : undefined),
        opacity: isDragging ? 0.8 : 1,
    };

    return (
        <div 
            ref={(node) => {
                setNodeRef(node);
                rowVirtualizer.measureElement(node);
            }}
            data-index={virtualRow.index}
            className={`group transition-colors duration-150 absolute top-0 left-0 w-full flex items-center py-2 z-10 hover:z-[30] hover:bg-zinc-100 dark:hover:bg-zinc-800/60 focus-within:z-[30] ${row.original.is_macro_item ? 'bg-zinc-100/80 dark:bg-zinc-800/50 border-y border-zinc-200 dark:border-zinc-700/50' : ''}`}
            style={style}
            onFocus={(e) => {
                // Ignore focus se for no botão do menu
                if ((e.target as HTMLElement).closest('.row-menu-btn')) return;
                setIsFocused(true);
            }}
            onBlur={(e) => {
                // Timeout para evitar flickers ao pular entre inputs da mesma linha
                setTimeout(() => {
                    if (!document.activeElement?.closest(`[data-index="${virtualRow.index}"]`)) {
                        setIsFocused(false);
                    }
                }, 0);
            }}
        >
            {/* Menu de Contexto */}
            {!activeAutocompleteRowId && !isFocused && (
                <div 
                    className="absolute left-10 top-[85%] z-[70] hidden group-hover:flex justify-center items-center pointer-events-auto shadow-xl rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                >
                    <div className="flex flex-row items-center p-1 gap-1 h-9">
                    
                    <button 
                        onClick={() => {
                            const originalIdx = data.findIndex((d: any) => d.id === row.original.id);
                            const newData = [...data];
                            newData.splice(originalIdx + 1, 0, {id: `macro_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`, item: "-", codigo: "", base: "", descricao: "Novo Item", und: "-", quant: 0, valorUnit: 0, total: 0, is_macro_item: true, level: row.original.level});
                            setData(recalculateNumbers(newData));
                        }}
                        className="row-menu-btn flex flex-row items-center justify-center px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors gap-1.5 h-full">
                        <List className="w-3 h-3" />
                        <span className="text-[10px] font-medium whitespace-nowrap">Item</span>
                    </button>

                    <button 
                        onClick={() => {
                            const originalIdx = data.findIndex((d: any) => d.id === row.original.id);
                            const newData = [...data];
                            newData.splice(originalIdx + 1, 0, {id: `serv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`, item: "-", codigo: "", base: "SINAPI", descricao: "Novo Serviço", und: "-", quant: 1, valorUnit: 0, total: 0, is_macro_item: false, level: (row.original.level || 0) + (row.original.is_macro_item ? 1 : 0)});
                            setData(recalculateNumbers(newData));
                        }}
                        className="row-menu-btn flex flex-row items-center justify-center px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors gap-1.5 h-full">
                        <Box className="w-3 h-3" />
                        <span className="text-[10px] font-medium whitespace-nowrap">Serviço</span>
                    </button>
                    
                    <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5"></div>

                    {row.original.is_macro_item && (
                        <>
                            <button 
                                onClick={() => {
                                    const originalIdx = data.findIndex((d: any) => d.id === row.original.id);
                                    const newData = [...data];
                                    const currentLvl = newData[originalIdx].level || 0;
                                    if (currentLvl > 0) {
                                        newData[originalIdx] = { ...newData[originalIdx], level: currentLvl - 1 };
                                        setData(recalculateNumbers(newData));
                                    }
                                }}
                                className="row-menu-btn flex flex-row items-center justify-center px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors h-full"
                                title="Recuar Nível do Bloco"
                            >
                                <span className="text-[12px] font-bold">{"<"}</span>
                            </button>

                            <button 
                                onClick={() => {
                                    const originalIdx = data.findIndex((d: any) => d.id === row.original.id);
                                    const newData = [...data];
                                    const currentLvl = newData[originalIdx].level || 0;
                                    if (currentLvl < 5) {
                                        newData[originalIdx] = { ...newData[originalIdx], level: currentLvl + 1 };
                                        setData(recalculateNumbers(newData));
                                    }
                                }}
                                className="row-menu-btn flex flex-row items-center justify-center px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors h-full"
                                title="Avançar Nível do Bloco"
                            >
                                <span className="text-[12px] font-bold">{">"}</span>
                            </button>
                            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5"></div>
                        </>
                    )}

                    <button 
                        onClick={() => {
                            const originalIdx = data.findIndex((d: any) => d.id === row.original.id);
                            if (onOpenCreatorModal) onOpenCreatorModal(row.original.descricao, originalIdx);
                        }}
                        className="row-menu-btn flex flex-row items-center justify-center px-2 py-1 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors gap-1.5 h-full"
                        title="Criar Composição Inédita baseada nesta linha"
                    >
                        <Wand2 className="w-3 h-3" />
                        <span className="text-[10px] font-medium whitespace-nowrap">Auto IA</span>
                    </button>
                    
                    <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5"></div>

                    <button 
                        onClick={() => {
                            const newData = data.filter((item:any) => item.id !== row.original.id);
                            setData(recalculateNumbers(newData));
                        }}
                        className="row-menu-btn flex flex-row items-center justify-center px-2 py-1 hover:bg-red-50 dark:hover:bg-red-500/10 rounded text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors gap-1.5 h-full">
                        <Trash2 className="w-3 h-3" />
                        <span className="text-[10px] font-medium whitespace-nowrap">Excluir</span>
                    </button>
                    </div>
                </div>
            )}
            
            <div className="flex flex-1 w-full relative">
                <div 
                    className="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-colors z-50 w-6 py-1 rounded-md text-indigo-400/50 hover:text-indigo-400 hover:bg-indigo-500/10"
                >
                    <button 
                       onClick={() => {
                           const originalIdx = data.findIndex((d: any) => d.id === row.original.id);
                           if (originalIdx <= 0) return;
                           const item = data[originalIdx];
                           const lvl = item.level ?? 0;
                           let myBlockEnd = originalIdx;
                           if (item.is_macro_item) {
                               for (let i = originalIdx + 1; i < data.length; i++) {
                                   if ((data[i].level ?? 0) <= lvl) break;
                                   myBlockEnd = i;
                               }
                           }
                           const myBlockSize = myBlockEnd - originalIdx + 1;
                           let targetIndex = -1;
                           for (let i = originalIdx - 1; i >= 0; i--) {
                               if ((data[i].level ?? 0) <= lvl) {
                                   targetIndex = i;
                                   break;
                               }
                           }
                           if (targetIndex !== -1) {
                               const newData = [...data];
                               const block = newData.splice(originalIdx, myBlockSize);
                               newData.splice(targetIndex, 0, ...block);
                               setData(recalculateNumbers(newData));
                           }
                       }}
                       className="hover:text-indigo-600 dark:hover:text-indigo-300 p-0 text-inherit cursor-pointer transition-colors"
                       title="Mover Bloco para Cima"
                    ><ChevronUp className="w-3 h-3" /></button>
                    <div 
                        {...attributes} 
                        {...listeners} 
                        className="cursor-grab active:cursor-grabbing hover:text-indigo-600 dark:hover:text-indigo-300 p-0 py-0.5 text-inherit transition-colors"
                        title="Arrastar e Soltar"
                    >
                        <GripVertical className="w-3 h-3" />
                    </div>
                    <button 
                       onClick={() => {
                           const originalIdx = data.findIndex((d: any) => d.id === row.original.id);
                           if (originalIdx === -1) return;
                           const item = data[originalIdx];
                           const lvl = item.level ?? 0;
                           let myBlockEnd = originalIdx;
                           if (item.is_macro_item) {
                               for (let i = originalIdx + 1; i < data.length; i++) {
                                   if ((data[i].level ?? 0) <= lvl) break;
                                   myBlockEnd = i;
                               }
                           }
                           const myBlockSize = myBlockEnd - originalIdx + 1;
                           let targetIndex = -1;
                           for (let i = myBlockEnd + 1; i < data.length; i++) {
                               if ((data[i].level ?? 0) <= lvl) {
                                   let targetBlockEnd = i;
                                   if (data[i].is_macro_item) {
                                       for (let j = i + 1; j < data.length; j++) {
                                           if ((data[j].level ?? 0) <= lvl) break;
                                           targetBlockEnd = j;
                                       }
                                   }
                                   targetIndex = targetBlockEnd + 1;
                                   break;
                               }
                           }
                           if (targetIndex === -1 && myBlockEnd < data.length - 1) {
                               targetIndex = data.length;
                           }
                           if (targetIndex !== -1) {
                               const newData = [...data];
                               const block = newData.splice(originalIdx, myBlockSize);
                               newData.splice(targetIndex - myBlockSize, 0, ...block);
                               setData(recalculateNumbers(newData));
                           }
                       }}
                       className="hover:text-indigo-600 dark:hover:text-indigo-300 p-0 text-inherit cursor-pointer transition-colors"
                       title="Mover Bloco para Baixo"
                    ><ChevronDown className="w-3 h-3" /></button>
                </div>
                {row.getVisibleCells().map((cell: any) => (
                    <div key={cell.id} style={{ width: cell.column.getSize(), flexGrow: cell.column.id === 'descricao' ? 1 : 0 }} className="px-3 shrink-0 flex items-center">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                ))}
            </div>
        </div>
    );
};

export function BudgetTable({ 
    onOpenCreatorModal
}: { 
    onOpenCreatorModal?: (query: string, rowIndex?: number) => void
}) {
  const { tableData: data, setTableData: setData, bdi, updateData, updateRow, updateItemPosition } = useBudgetStore();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [memoryModalData, setMemoryModalData] = useState<{ matches: any[], rowIndex: number, legado: string } | null>(null);
  const [detailsItem, setDetailsItem] = useState<BudgetItem | null>(null);

  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set());
  
  const toggleCollapse = (id: string) => {
      setCollapsedRows(prev => {
          const newSet = new Set(prev);
          if (newSet.has(id)) newSet.delete(id);
          else newSet.add(id);
          return newSet;
      });
  };

  const visibleData = React.useMemo(() => {
      let hiddenUntilLevel = -1;
      return data.filter((item) => {
          if (hiddenUntilLevel !== -1) {
              if (item.level! <= hiddenUntilLevel) {
                  hiddenUntilLevel = -1;
              } else {
                  return false;
              }
          }
          if (item.is_macro_item && collapsedRows.has(item.id)) {
              hiddenUntilLevel = item.level!;
          }
          return true;
      });
  }, [data, collapsedRows]);

  const handleUpdateData = React.useCallback((id: string, columnId: string, value: any) => {
      const idx = data.findIndex(d => d.id === id);
      if (idx !== -1) updateData(idx, columnId, value);
  }, [data, updateData]);
  
  const handleUpdateRow = React.useCallback((id: string, newRowData: Partial<BudgetItem>) => {
      const idx = data.findIndex(d => d.id === id);
      if (idx !== -1) updateRow(idx, newRowData);
  }, [data, updateRow]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && memoryModalData) {
            setMemoryModalData(null);
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [memoryModalData]);



  const columns = React.useMemo(() => [
    columnHelper.accessor("item", { 
        header: "Item", 
        size: 90,
        cell: info => {
            const isMacro = info.row.original.is_macro_item;
            const isCollapsed = (info.table.options.meta as any)?.collapsedRows?.has(info.row.original.id);
            const toggle = (info.table.options.meta as any)?.toggleCollapse;
            
            return (
                <div 
                    className={`flex items-center w-full h-full truncate ${isMacro ? 'text-zinc-900 dark:text-zinc-100 font-bold cursor-pointer hover:text-indigo-600 pl-3' : 'text-zinc-700 dark:text-zinc-300 font-semibold pl-[1.6rem]'}`}
                    onClick={isMacro ? () => toggle(info.row.original.id) : undefined}
                >
                    {isMacro && (
                        <span className="mr-1 text-zinc-400">
                            {isCollapsed ? <ChevronRight className="w-4 h-4 inline" /> : <ChevronDown className="w-4 h-4 inline" />}
                        </span>
                    )}
                    {info.getValue()}
                </div>
            );
        }
    }),
    columnHelper.accessor("codigo", { 
        header: "Código", 
        size: 100,
        cell: info => info.row.original.is_macro_item ? <div className="text-center"></div> : <CodigoCell initialValue={info.getValue()} item={info.row.original} onOpenDetails={(info.table.options.meta as any)?.handleOpenDetails} onUpdate={(v:any) => (info.table.options.meta as any)?.handleUpdateData(info.row.original.id, 'codigo', v)} />
    }),
    columnHelper.accessor("base", { 
        header: "Base", 
        size: 80,
        cell: info => info.row.original.is_macro_item ? <div className="text-center"></div> : <CellInput initialValue={info.getValue()} onUpdate={(v:any) => (info.table.options.meta as any)?.handleUpdateData(info.row.original.id, 'base', v)} className="w-full bg-transparent text-zinc-700 dark:text-zinc-300 outline-none px-1 rounded text-center" />
    }),
    columnHelper.accessor("descricao", { 
        header: "Descrição do Serviço",
        size: 600,
        cell: info => {
            const lvl = info.row.original.level ?? (info.row.original.is_macro_item ? 0 : 1);
            // O nível 0 e 1 de serviços já são razoáveis sem margem. Usar margin left apenas se > 0 e for serviço, ou > 0 para macros.
            // Para ficar super elegante, indentamos 1rem por level.
            const indentStyle = { paddingLeft: `${lvl * 1.5}rem` };

            if (info.row.original.is_macro_item) {
                return (
                    <div className="w-full px-2" style={indentStyle}>
                        <CellInput initialValue={info.getValue()} onUpdate={(v:any) => (info.table.options.meta as any)?.handleUpdateRow(info.row.original.id, {descricao: v})} className="w-full bg-transparent font-bold text-zinc-900 dark:text-zinc-100 truncate outline-none" />
                    </div>
                );
            }
            const hasMemory = info.row.original.memoria_calculo && info.row.original.memoria_calculo.length > 0;
            return (
                <div className="flex items-center gap-2 w-full h-full group/desc" style={indentStyle}>
                    <div className="flex-1">
                        <AutocompleteDescricaoCell 
                            initialValue={info.getValue()} 
                            rowIndex={info.row.index}
                            onUpdateRow={(newRowData: any) => (info.table.options.meta as any)?.handleUpdateRow(info.row.original.id, newRowData)}
                            onOpenChange={(info.table.options.meta as any)?.setAutocompleteOpen ? (isOpen: boolean) => (info.table.options.meta as any)?.setAutocompleteOpen(isOpen ? info.row.original.id : null) : undefined}
                        />
                    </div>
                    {hasMemory && (
                        <button 
                            onClick={() => (info.table.options.meta as any)?.setMemoryModalData({ matches: info.row.original.memoria_calculo!, rowIndex: info.row.index, legado: info.row.original.descricao_legada || info.row.original.descricao })}
                            className="p-1.5 rounded-md text-indigo-400/50 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors opacity-0 group-hover/desc:opacity-100 flex-shrink-0"
                            title="Ver Memória de Cálculo da IA"
                        >
                            <Brain className="w-4 h-4" />
                        </button>
                    )}
                </div>
            );
        }
    }),
    columnHelper.accessor("ai_status", {
        header: "Parecer IA",
        size: 110,
        cell: info => {
            if (info.row.original.is_macro_item) return <div className="text-center"></div>;
            const status = info.getValue() || 'PENDENTE';
            const just = info.row.original.ai_justificativa || '';
            
            let color = "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 dark:text-zinc-400";
            let label = status.replace(/_/g, ' ');
            let tooltipLabel = label;
            
            if (status.includes("ACEITO COM") || status.includes("RESSALVA") || status.includes("PREMISSA")) {
                color = "bg-amber-500/10 text-amber-400 border border-amber-500/20";
                label = "RESSALVA";
                tooltipLabel = "ACEITO COM RESSALVA";
            } else if (status === "ACEITO" || status.includes("APROVADO")) {
                color = "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
                label = "ACEITO";
                tooltipLabel = "ACEITO";
            } else if (status === "SUBSTITUIDO") {
                color = "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20";
                label = "SUBSTITUÍDO";
                tooltipLabel = "SUBSTITUÍDO";
            } else if (status.includes("REJEITADO") || status.includes("ERRO") || status.includes("VAZIO")) {
                color = "bg-red-500/10 text-red-400 border border-red-500/20";
                if (status === "REJEITADO_FILTRO_MATEMATICO") {
                    label = "REJEITADO";
                    tooltipLabel = "REJEITADO";
                }
            } else if (status === "PROCESSANDO") {
                color = "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse";
            }
            
            return (
                <div className="relative group/tooltip flex items-center h-full">
                    <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold w-max ${color} cursor-help truncate max-w-full`}>
                        {label}
                    </div>
                    {just && (
                        <div className="absolute left-full ml-3 top-0 w-80 p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-2xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-100 z-[9999] text-xs text-zinc-700 dark:text-zinc-300 font-normal whitespace-normal leading-relaxed pointer-events-none">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{tooltipLabel}</div>
                            {just}
                            <div className="absolute top-2 -left-1.5 w-3 h-3 bg-white dark:bg-zinc-900 border-l border-t border-zinc-200 dark:border-zinc-800 -rotate-45"></div>
                        </div>
                    )}
                </div>
            );
        }
    }),
    columnHelper.accessor("und", { 
        header: "Und", 
        size: 60,
        cell: info => info.row.original.is_macro_item ? <div className="text-center"></div> : <CellInput initialValue={info.getValue()} onUpdate={(v:any) => (info.table.options.meta as any)?.handleUpdateData(info.row.original.id, 'und', v)} className="w-full bg-transparent text-zinc-400 dark:text-zinc-500 outline-none px-1 rounded text-center" />
    }),
    columnHelper.accessor("quant", { 
        header: "Quant.", 
        size: 90,
        cell: info => info.row.original.is_macro_item ? <div className="text-center"></div> : <CellInput type="number" step="0.01" initialValue={info.getValue()} onUpdate={(v:any) => (info.table.options.meta as any)?.handleUpdateData(info.row.original.id, 'quant', v)} className="w-full bg-transparent text-zinc-700 dark:text-zinc-300 outline-none px-1 rounded text-center" />
    }),
    columnHelper.accessor("valorUnit", { 
        header: "Valor Unit", 
        size: 110,
        cell: info => info.row.original.is_macro_item ? <div className="text-center"></div> : <CellInput type="number" step="0.01" initialValue={info.getValue()} onUpdate={(v:any) => (info.table.options.meta as any)?.handleUpdateData(info.row.original.id, 'valorUnit', v)} className="w-full bg-transparent text-zinc-700 dark:text-zinc-300 outline-none px-1 rounded text-center" />
    }),
    columnHelper.display({
        id: "valorUnitBdi",
        header: "Valor c/ BDI",
        size: 110,
        cell: info => {
            if (info.row.original.is_macro_item) return <div className="text-center"></div>;
            const val = info.row.original.valorUnit * (1 + bdi / 100);
            return <div className="text-center px-1 text-zinc-700 dark:text-zinc-300 w-full">{val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>;
        }
    }),
    columnHelper.display({
        id: "totalBdi",
        header: "Total",
        size: 130,
        cell: info => {
            if (info.row.original.is_macro_item) {
                const subtotalBdi = info.row.original.total * (1 + bdi / 100);
                return <div className="text-center px-1 font-bold text-zinc-900 dark:text-zinc-100 w-full">{subtotalBdi.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>;
            }
            const val = (info.row.original.valorUnit * (1 + bdi / 100)) * info.row.original.quant;
            return <div className="text-center px-1 font-semibold text-zinc-800 dark:text-zinc-200 w-full">{val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>;
        }
    })
  ], [bdi, updateData]);

  const [activeAutocompleteRowId, setActiveAutocompleteRowId] = useState<string | null>(null);

  const table = useReactTable({
    data: visibleData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
    getRowId: row => row.id,
    meta: {
        updateRow,
        handleUpdateData,
        handleUpdateRow,
        updateItemPosition: updateItemPosition,
        collapsedRows,
        toggleCollapse,
        handleOpenDetails: setDetailsItem,
        setMemoryModalData,
        setAutocompleteOpen: setActiveAutocompleteRowId
    }
  });

  const { rows } = table.getRowModel();
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 44, // Altura reduzida
    overscan: 10,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Ajuda a distinguir entre clique e arraste
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
        const oldIndex = data.findIndex(item => item.id === active.id);
        const newIndex = data.findIndex(item => item.id === over.id);
        
        if (oldIndex !== -1 && newIndex !== -1) {
            setData(prev => moveRowOrBlock(prev, oldIndex, newIndex));
        }
    }
  };

  if (data.length === 0) {
      return (
          <div className="w-full flex flex-col items-center justify-center py-20 bg-zinc-50 dark:bg-[#09090b] rounded-lg border border-zinc-200 dark:border-zinc-800 border-dashed">
              <Layers className="w-12 h-12 text-zinc-700 mb-4" />
              <h3 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">Nenhum orçamento carregado</h3>
              <p className="text-zinc-400 dark:text-zinc-500 text-sm mt-1 max-w-sm text-center">Faça o upload da sua planilha Excel para a Inteligência Artificial analisar.</p>
          </div>
      );
  }

  return (
    <div className="flex flex-col gap-4 w-full h-full">
        <div className="flex items-center justify-between text-sm text-zinc-400 dark:text-zinc-500 dark:text-zinc-400">
            <span>Orçamento com {data.length} itens</span>
        </div>

        <div 
            ref={tableContainerRef}
            className="w-full h-[65vh] overflow-auto bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-xl custom-scrollbar"
        >
          <div className="w-full text-sm text-left flex flex-col min-w-max">
            {/* Header */}
            <div className="text-xs uppercase bg-white dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 z-20 shadow-sm flex select-none">
              {table.getHeaderGroups().map((headerGroup) => (
                <div key={headerGroup.id} className="flex flex-1">
                  {headerGroup.headers.map((header) => (
                    <div 
                        key={header.id} 
                        style={{ width: header.getSize(), flexGrow: header.column.id === 'descricao' ? 1 : 0 }} 
                        className={`px-3 py-2 font-medium flex items-center gap-1 shrink-0 relative group hover:bg-zinc-100 dark:hover:bg-zinc-700/50 transition-colors cursor-pointer ${header.column.id === 'descricao' ? 'justify-start' : 'justify-center text-center'}`}
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
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={data.map(d => d.id)} strategy={verticalListSortingStrategy}>
                <div 
                    className="relative w-full flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800/50"
                    style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    return (
                        <SortableRow 
                            key={row.id}
                            row={row}
                            virtualRow={virtualRow}
                            data={data}
                            setData={setData}
                            onOpenCreatorModal={onOpenCreatorModal}
                            rowVirtualizer={rowVirtualizer}
                            activeAutocompleteRowId={activeAutocompleteRowId}
                        />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* Modal de Memória de Cálculo (Explainability) */}
        {memoryModalData && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                        <div className="flex items-center gap-2 text-indigo-400">
                            <Brain className="w-5 h-5" />
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Memória de Cálculo da IA</h2>
                        </div>
                        <button 
                            onClick={() => setMemoryModalData(null)}
                            className="p-1.5 rounded-md hover:bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:text-zinc-100 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    
                    <div className="p-4 overflow-y-auto custom-scrollbar flex flex-col gap-3">
                        <div className="bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-4 mb-2 flex flex-col gap-2 shrink-0">
                            <p className="text-sm text-zinc-700 dark:text-zinc-300">
                                A IA analisou o banco de dados do SINAPI e selecionou as {memoryModalData.matches.length} opções mais prováveis antes de tomar a decisão final para o item:
                            </p>
                            <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-3 py-2 rounded-md border border-indigo-500/20 break-words whitespace-normal">
                                {memoryModalData.legado}
                            </p>
                        </div>
                        
                        {memoryModalData.matches.map((match: any, idx: number) => (
                            <div key={idx} className="bg-white dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-700/50 rounded-lg p-4 flex flex-col gap-3 relative overflow-hidden group/match hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors shrink-0">
                                {idx === 0 && (
                                    <div className="absolute top-0 right-0 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-bl-lg border-l border-b border-emerald-500/20">
                                        Vencedor
                                    </div>
                                )}
                                <div className="flex items-center gap-2 flex-wrap pr-16">
                                    <span className="text-xs font-mono text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded border border-blue-400/20">{match.codigo}</span>
                                    <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded border border-emerald-400/20">R$ {Number(match.custo).toFixed(2)}</span>
                                    <span className="text-xs font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">{match.unidade}</span>
                                    <span className="text-xs font-medium text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">Match: {match.score}%</span>
                                </div>
                                <div className="flex items-start justify-between gap-4">
                                    <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed flex-1 break-words whitespace-normal">
                                        {match.descricao}
                                    </p>
                                    <button 
                                        onClick={() => {
                                            if (window.confirm("Deseja substituir o item atual por esta composição do SINAPI?")) {
                                                updateRow(memoryModalData.rowIndex, {
                                                    codigo: match.codigo,
                                                    descricao: match.descricao,
                                                    valorUnit: Number(match.custo) || 0,
                                                    und: match.unidade,
                                                    ai_status: 'SUBSTITUIDO',
                                                    ai_justificativa: 'Composição substituída manualmente pelo usuário via Memória de Cálculo.',
                                                    base: 'SINAPI'
                                                });
                                                setMemoryModalData(null);
                                            }
                                        }}
                                        className="opacity-0 group-hover/match:opacity-100 transition-opacity bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded shrink-0"
                                    >
                                        Substituir
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    
                    <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
                        <button 
                            onClick={() => setMemoryModalData(null)}
                            className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm font-medium text-zinc-900 dark:text-zinc-100 rounded-md transition-colors"
                        >
                            Fechar
                        </button>
                    </div>
                </div>
            </div>
        )}

        {detailsItem && (
            <CompositionDetailsModal 
                isOpen={!!detailsItem} 
                item={detailsItem} 
                onClose={() => setDetailsItem(null)} 
                onSave={(updated) => handleUpdateRow(updated.id, updated)} 
            />
        )}
    </div>
  );
}

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { BudgetItem } from '@/utils/budgetUtils';

// Componente isolado para evitar perda de foco e lag durante a digitação
export interface CellInputProps {
    initialValue: string | number;
    onUpdate: (val: string | number) => void;
    type?: string;
    className?: string;
    step?: string;
}

export const CellInput = ({ initialValue, onUpdate, type = "text", className = "", step }: CellInputProps) => {
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

export const CodigoCell = ({ initialValue, item, onUpdate, onOpenDetails }: CodigoCellProps) => {
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

export const AutocompleteDescricaoCell = ({ initialValue, rowIndex, onUpdateRow, onOpenChange }: AutocompleteDescricaoCellProps) => {
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

    const onOpenChangeRef = useRef(onOpenChange);
    useEffect(() => {
        onOpenChangeRef.current = onOpenChange;
    }, [onOpenChange]);

    useEffect(() => {
        if (onOpenChangeRef.current) onOpenChangeRef.current(isOpen);
    }, [isOpen]);



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


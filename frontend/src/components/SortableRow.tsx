import React, { useState } from "react";
import { useSortable } from '@dnd-kit/sortable';
import { flexRender } from "@tanstack/react-table";
import { List, Box, Wand2, Trash2, ChevronUp, GripVertical, ChevronDown } from "lucide-react";
import { recalculateNumbers } from '@/utils/budgetUtils';

export const SortableRow = React.memo( ({ row, virtualRow, data, setData, onOpenCreatorModal, rowVirtualizer, activeAutocompleteRowId }: any) => {
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
});
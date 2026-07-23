import React, { useState, useEffect } from 'react';
import { X, Save, Edit3, Loader2, Info } from 'lucide-react';
import { BudgetItem } from '../utils/budgetUtils';

interface CompositionDetailsModalProps {
    isOpen: boolean;
    item: BudgetItem | null;
    onClose: () => void;
    onSave: (updatedItem: BudgetItem) => void;
}

export function CompositionDetailsModal({ isOpen, item, onClose, onSave }: CompositionDetailsModalProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [details, setDetails] = useState<any[]>([]);
    const [error, setError] = useState('');

    const isCustom = item?.base === 'CP' || item?.codigo?.startsWith('CP_');

    useEffect(() => {
        if (!isOpen || !item) return;
        
        setError('');
        setIsEditing(false);
        setDetails([]);
        
        if (isCustom) {
            if (item.composicao_detalhada) {
                setDetails(JSON.parse(JSON.stringify(item.composicao_detalhada)));
                setIsEditing(true); // Custom é sempre editável
            } else {
                setError('Detalhes da composição não encontrados no estado da tabela.');
            }
        } else {
            // Busca do SINAPI
            setIsLoading(true);
            fetch(`/api/composicao/${item.codigo}`, {
                headers: {
                    "x-api-key": process.env.NEXT_PUBLIC_API_KEY || "chave-secreta-padrao"
                }
            })
                .then(res => {
                    if (!res.ok) throw new Error('Falha ao buscar detalhes da composição no banco de dados.');
                    return res.json();
                })
                .then(data => {
                    if (data && data.itens) {
                        setDetails(data.itens);
                    } else {
                        throw new Error('Composição sem itens detalhados.');
                    }
                })
                .catch(err => {
                    console.error(err);
                    setError(err.message || 'Erro ao carregar.');
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    }, [isOpen, item, isCustom]);

    if (!isOpen || !item) return null;

    const handleItemChange = (index: number, field: string, value: any) => {
        const newDetails = [...details];
        newDetails[index][field] = value;
        
        // Recalcular
        if (field === 'coeficiente' || field === 'valor_unitario') {
            const coef = parseFloat(newDetails[index].coeficiente) || 0;
            const val = parseFloat(newDetails[index].valor_unitario) || 0;
            newDetails[index].valor_total = coef * val;
        }
        
        setDetails(newDetails);
    };

    const handleSave = () => {
        if (!isCustom) return;
        
        const newValorUnit = details.reduce((acc, curr) => acc + (curr.valor_total || 0), 0);
        
        const updatedItem = {
            ...item,
            valorUnit: newValorUnit,
            total: newValorUnit * (item.quant || 1),
            composicao_detalhada: details
        };
        
        onSave(updatedItem);
        onClose();
    };

    const totalCalculado = details.reduce((acc, curr) => acc + (curr.valor_total || 0), 0);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-zinc-900">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                            {isCustom ? <Edit3 className="w-5 h-5 text-indigo-400" /> : <Info className="w-5 h-5 text-indigo-400" />}
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                                {item.codigo} <span className="text-zinc-400 font-normal">| {item.descricao}</span>
                            </h2>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                {isCustom ? 'Edite os itens e coeficientes desta Composição Própria.' : 'Visualização analítica da Composição SINAPI.'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md text-zinc-500 dark:text-zinc-400 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 custom-scrollbar">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
                            <p>Buscando composição analítica...</p>
                        </div>
                    ) : error ? (
                        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-center">
                            {error}
                        </div>
                    ) : (
                        <div className="w-full">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-zinc-500 dark:text-zinc-400 uppercase bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700/50">
                                        <tr>
                                            <th className="px-4 py-3 font-medium">Tipo</th>
                                            <th className="px-4 py-3 font-medium">Código</th>
                                            <th className="px-4 py-3 font-medium">Insumo</th>
                                            <th className="px-4 py-3 font-medium text-center w-20">Und</th>
                                            <th className="px-4 py-3 font-medium text-right w-28">Coeficiente</th>
                                            <th className="px-4 py-3 font-medium text-right w-28">R$ Unit</th>
                                            <th className="px-4 py-3 font-medium text-right w-28">R$ Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700/50">
                                        {details.map((row, idx) => (
                                            <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                                                <td className="px-4 py-2">
                                                    <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                                                        (row.tipo || '').includes('Mão de Obra') ? 'bg-amber-500/10 text-amber-400' :
                                                        (row.tipo || '').includes('Material') ? 'bg-blue-500/10 text-blue-400' :
                                                        'bg-emerald-500/10 text-emerald-400'
                                                    }`}>
                                                        {row.tipo || 'OUTRO'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 text-zinc-400 dark:text-zinc-500 font-mono text-xs">{row.codigo_sinapi || '-'}</td>
                                                <td className="px-4 py-2 text-zinc-800 dark:text-zinc-200">
                                                    {row.descricao}
                                                </td>
                                                <td className="px-4 py-2 text-center text-zinc-400 dark:text-zinc-500 font-mono text-xs">
                                                    {row.unidade}
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                    {isEditing ? (
                                                        <input 
                                                            type="number" 
                                                            step="0.0001"
                                                            value={row.coeficiente} 
                                                            onChange={e => handleItemChange(idx, 'coeficiente', parseFloat(e.target.value) || 0)}
                                                            className="w-full text-right bg-transparent border-b border-zinc-300 dark:border-zinc-600 focus:border-indigo-500 outline-none px-1 text-indigo-400 font-mono"
                                                        />
                                                    ) : (
                                                        <span className="text-zinc-700 dark:text-zinc-300 font-mono">{Number(row.coeficiente).toFixed(4)}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                    <span className="text-zinc-700 dark:text-zinc-300 font-mono">{Number(row.valor_unitario).toFixed(2)}</span>
                                                </td>
                                                <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300 font-mono font-medium">
                                                    {Number(row.valor_total || 0).toFixed(2)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            
                            <div className="bg-zinc-50 dark:bg-zinc-800/50 px-6 py-4 flex justify-between items-center border-t border-zinc-200 dark:border-zinc-700/50">
                                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Custo Unitário Total</span>
                                <span className="text-2xl font-bold text-emerald-400">R$ {totalCalculado.toFixed(2).replace('.', ',')}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex justify-end gap-3">
                    <button 
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                    >
                        {isCustom ? 'Cancelar' : 'Fechar'}
                    </button>
                    {isCustom && (
                        <button 
                            onClick={handleSave}
                            disabled={isLoading || !!error}
                            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg disabled:opacity-50 flex items-center gap-2"
                        >
                            <Save className="w-4 h-4" /> Salvar Alterações
                        </button>
                    )}
                </div>

            </div>
        </div>
    );
}

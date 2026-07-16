import React, { useState } from 'react';
import { Sparkles, Loader2, X, Plus, AlertCircle, Calculator } from 'lucide-react';

interface ComposicaoItem {
    codigo_sinapi: string;
    descricao: string;
    tipo: string;
    unidade: string;
    coeficiente: number;
    valor_unitario: number;
    valor_total: number;
}

export interface ComposicaoGerada {
    servico: string;
    unidade_medida: string;
    itens: ComposicaoItem[];
    valor_total_composicao: number;
    justificativa: string;
}

interface CompositionCreatorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAddComposition: (composicao: ComposicaoGerada, query: string) => void;
}

export function CompositionCreatorModal({ isOpen, onClose, onAddComposition }: CompositionCreatorModalProps) {
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ComposicaoGerada | null>(null);

    if (!isOpen) return null;

    const handleGenerate = async () => {
        if (!query.trim()) return;
        setIsLoading(true);
        setError(null);
        setResult(null);

        try {
            const res = await fetch('/api/orcamento/gerar-composicao-ia', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ servico: query })
            });

            const data = await res.json();
            
            if (!res.ok) {
                throw new Error(data.detail || 'Erro ao gerar composição');
            }

            if (data.status === 'SUCESSO' && data.data) {
                setResult(data.data);
            } else {
                throw new Error('Falha no formato de resposta da IA');
            }
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Ocorreu um erro ao consultar os Agentes IA.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAdd = () => {
        if (result) {
            onAddComposition(result, query);
            onClose();
            // Reseta o modal
            setQuery('');
            setResult(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[#09090b] border border-zinc-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                            <Sparkles className="w-5 h-5 text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-zinc-100">Criador de Composição Própria</h2>
                            <p className="text-xs text-zinc-400">Multi-Agentes de Engenharia (IA)</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-md text-zinc-400 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    
                    {/* Input Area */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-zinc-300">Descreva o serviço inédito que deseja compor:</label>
                        <div className="flex gap-3">
                            <input 
                                type="text" 
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Ex: Piso de porcelanato 90x90 com argamassa ACIII dupla colagem"
                                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-zinc-600"
                                onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleGenerate()}
                            />
                            <button 
                                onClick={handleGenerate}
                                disabled={isLoading || !query.trim()}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-indigo-500/20"
                            >
                                {isLoading ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> Elaborando...</>
                                ) : (
                                    <><Calculator className="w-4 h-4" /> Gerar CPU</>
                                )}
                            </button>
                        </div>
                        {error && (
                            <p className="text-sm text-red-400 flex items-center gap-2 mt-2">
                                <AlertCircle className="w-4 h-4" /> {error}
                            </p>
                        )}
                    </div>

                    {/* Result Area */}
                    {result && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                                <div className="p-4 bg-zinc-800/30 border-b border-zinc-800 flex justify-between items-center">
                                    <div>
                                        <h3 className="font-semibold text-zinc-100 text-lg leading-tight">{result.servico}</h3>
                                        <p className="text-xs text-zinc-400 uppercase tracking-wider mt-1 font-mono">Unidade: {result.unidade_medida}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-zinc-400 uppercase tracking-wider mb-0.5">Custo Unitário Total</p>
                                        <p className="text-2xl font-bold text-emerald-400">R$ {result.valor_total_composicao.toFixed(2).replace('.', ',')}</p>
                                    </div>
                                </div>
                                
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-zinc-400 uppercase bg-zinc-900/80 border-b border-zinc-800">
                                            <tr>
                                                <th className="px-4 py-3 font-medium">Tipo</th>
                                                <th className="px-4 py-3 font-medium">Código</th>
                                                <th className="px-4 py-3 font-medium">Insumo</th>
                                                <th className="px-4 py-3 font-medium text-center">Und</th>
                                                <th className="px-4 py-3 font-medium text-right">Coeficiente</th>
                                                <th className="px-4 py-3 font-medium text-right">R$ Unit</th>
                                                <th className="px-4 py-3 font-medium text-right">R$ Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-800/50">
                                            {result.itens.map((item, idx) => (
                                                <tr key={idx} className="hover:bg-zinc-800/30 transition-colors">
                                                    <td className="px-4 py-3">
                                                        <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                                                            item.tipo.includes('Mão de Obra') ? 'bg-amber-500/10 text-amber-400' :
                                                            item.tipo.includes('Material') ? 'bg-blue-500/10 text-blue-400' :
                                                            'bg-emerald-500/10 text-emerald-400'
                                                        }`}>
                                                            {item.tipo}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{item.codigo_sinapi}</td>
                                                    <td className="px-4 py-3 text-zinc-200">{item.descricao}</td>
                                                    <td className="px-4 py-3 text-center text-zinc-500 font-mono text-xs">{item.unidade}</td>
                                                    <td className="px-4 py-3 text-right text-zinc-300 font-mono">{item.coeficiente.toFixed(4)}</td>
                                                    <td className="px-4 py-3 text-right text-zinc-300 font-mono">{item.valor_unitario.toFixed(2)}</td>
                                                    <td className="px-4 py-3 text-right text-zinc-300 font-mono font-medium">{item.valor_total.toFixed(2)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Justificativa Auditada */}
                            <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-lg flex gap-3 items-start">
                                <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="text-sm font-semibold text-indigo-300 mb-1">Auditoria dos Agentes IA</h4>
                                    <p className="text-sm text-zinc-300 leading-relaxed">
                                        {result.justificativa}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                </div>

                {/* Footer Actions */}
                <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/50 flex justify-end gap-3">
                    <button 
                        onClick={onClose}
                        className="px-5 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                        Fechar
                    </button>
                    <button 
                        onClick={handleAdd}
                        disabled={!result}
                        className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg disabled:opacity-50 flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" /> Adicionar ao Orçamento
                    </button>
                </div>

            </div>
        </div>
    );
}

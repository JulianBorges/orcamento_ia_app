import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { BudgetItem } from '../utils/budgetUtils';

export const useAutoSave = (tableData: BudgetItem[], title: string) => {
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const lastSavedState = useRef<string>('');
    const saveTimeout = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // Dirty Check (Comparação Profunda via serialização)
        // Evita disparos falsos causados por re-renders ou mudanças que não afetam a persistência
        const currentState = JSON.stringify({ title, data: tableData });
        
        if (tableData.length === 0 || currentState === lastSavedState.current) {
            return;
        }

        // Limpa o timer anterior (Debounce nativo e rigoroso)
        if (saveTimeout.current) {
            clearTimeout(saveTimeout.current);
        }

        // Aguarda 3000ms após o usuário PARAR de interagir/digitar
        saveTimeout.current = setTimeout(async () => {
            // Feedback Visual Controlado: Só aparece quando o HTTP vai realmente decolar
            setSaveStatus('saving');
            
            try {
                // Upsert budget to Supabase
                const { error } = await supabase
                    .from('budgets')
                    .upsert({
                        id: 'default_budget',
                        title: title,
                        data: tableData,
                        updated_at: new Date().toISOString()
                    });

                if (error) {
                    console.error("Auto-save fail:", error.message);
                    setSaveStatus('error');
                } else {
                    // Confirma o estado gravado para futuras comparações
                    lastSavedState.current = currentState;
                    setSaveStatus('saved');
                    setTimeout(() => setSaveStatus('idle'), 2000);
                }
            } catch (err) {
                console.error("Auto-save error:", err);
                setSaveStatus('error');
            }
        }, 3000);

        // Cleanup function garante que cliques desenfreados/desmontagens cancelem o timer pendente
        return () => {
            if (saveTimeout.current) {
                clearTimeout(saveTimeout.current);
            }
        };
    }, [tableData, title]);

    return { saveStatus };
};

import { useEffect, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { supabase } from '../lib/supabaseClient';
import { BudgetItem } from '../utils/budgetUtils';

export const useAutoSave = (tableData: BudgetItem[], title: string) => {
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    const debouncedSave = useDebouncedCallback(
        async (data: BudgetItem[], budgetTitle: string) => {
            if (data.length === 0) return;
            try {
                // Upsert budget to Supabase
                // Usando um ID fixo 'default_budget' até que o Auth (Frente 1) esteja 100% implementado
                const { error } = await supabase
                    .from('budgets')
                    .upsert({
                        id: 'default_budget',
                        title: budgetTitle,
                        data: data,
                        updated_at: new Date().toISOString()
                    });

                if (error) {
                    // Ignora erro se a tabela ainda não existir no supabase, apenas loga
                    console.error("Auto-save fail:", error.message);
                    setSaveStatus('error');
                } else {
                    setSaveStatus('saved');
                    setTimeout(() => setSaveStatus('idle'), 2000);
                }
            } catch (err) {
                console.error("Auto-save error:", err);
                setSaveStatus('error');
            }
        },
        3000
    );

    useEffect(() => {
        if (tableData.length > 0) {
            setSaveStatus('saving');
            debouncedSave(tableData, title);
        }
    }, [tableData, title, debouncedSave]);

    return { saveStatus };
};

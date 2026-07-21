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
  is_macro_item?: boolean;
  level?: number;
  macro_etapa_pai?: string;
  ai_status?: string;
  ai_justificativa?: string;
  memoria_calculo?: any[];
  descricao_legada?: string;
};

export const recalculateNumbers = (data: BudgetItem[]): BudgetItem[] => {
    let counters = [0, 0, 0, 0, 0, 0];
    let currentMacro = "";
    let currentMacroLevel = -1;

    const numberedData = data.map((item) => {
        let lvl = item.level ?? 0;
        
        if (item.is_macro_item) {
            currentMacroLevel = lvl;
            currentMacro = item.descricao;
            counters[lvl]++;
            for (let i = lvl + 1; i < counters.length; i++) {
                counters[i] = 0;
            }
        } else {
            lvl = currentMacroLevel === -1 ? 0 : currentMacroLevel + 1;
            counters[lvl]++;
            for (let i = lvl + 1; i < counters.length; i++) {
                counters[i] = 0;
            }
        }

        let itemNumber = "";
        if (lvl === 0 && item.is_macro_item) {
            itemNumber = `${counters[0] || 0}.0`;
        } else {
            const parts = counters.slice(0, lvl + 1);
            if (parts[0] === 0) parts[0] = 0; 
            itemNumber = parts.join('.');
        }

        return { 
            ...item, 
            level: lvl, 
            item: itemNumber,
            macro_etapa_pai: (lvl === 0 && item.is_macro_item) ? "" : (currentMacro || "Geral")
        };
    });

    for (let i = 0; i < numberedData.length; i++) {
        if (numberedData[i].is_macro_item) {
            let sum = 0;
            const macroLvl = numberedData[i].level!;
            for (let j = i + 1; j < numberedData.length; j++) {
                const childLvl = numberedData[j].level!;
                if (childLvl <= macroLvl) break; 
                if (!numberedData[j].is_macro_item) {
                    sum += numberedData[j].total;
                }
            }
            numberedData[i].total = sum;
        }
    }

    return numberedData;
};

export const moveRowOrBlock = (data: BudgetItem[], oldIndex: number, newIndex: number): BudgetItem[] => {
    if (oldIndex < 0 || oldIndex >= data.length || newIndex < 0 || newIndex >= data.length || oldIndex === newIndex) {
        return data;
    }

    const itemToMove = data[oldIndex];
    let blockLength = 1;
    if (itemToMove.is_macro_item) {
        const macroLvl = itemToMove.level!;
        for (let i = oldIndex + 1; i < data.length; i++) {
            if ((data[i].level!) <= macroLvl) break;
            blockLength++;
        }
    }

    const newData = [...data];
    const block = newData.splice(oldIndex, blockLength);
    
    let adjustedNewIndex = newIndex;
    if (newIndex > oldIndex) {
        adjustedNewIndex -= (blockLength - 1); 
    }

    newData.splice(adjustedNewIndex, 0, ...block);
    
    return recalculateNumbers(newData);
};

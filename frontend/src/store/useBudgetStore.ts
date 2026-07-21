import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BudgetItem, recalculateNumbers, moveRowOrBlock } from '../utils/budgetUtils';

interface BudgetState {
  tableData: BudgetItem[];
  bdi: number;
  title: string;
  isProcessing: boolean;
  uploadProgress: number | null;
  setTableData: (data: BudgetItem[] | ((prev: BudgetItem[]) => BudgetItem[])) => void;
  setBdi: (bdi: number) => void;
  setTitle: (title: string) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  setUploadProgress: (progress: number | null) => void;
  updateData: (rowIndex: number, columnId: string, value: any) => void;
  updateRow: (rowIndex: number, newRowData: Partial<BudgetItem>) => void;
  updateItemPosition: (oldIndex: number, newNumberText: string) => void;
  clearBudget: () => void;
}

export const useBudgetStore = create<BudgetState>()(
  persist(
    (set) => ({
      tableData: [],
      bdi: 25.0,
      title: 'Orçamento Base',
      isProcessing: false,
      uploadProgress: null,

      setTableData: (data) => set((state) => ({
        tableData: typeof data === 'function' ? data(state.tableData) : data
      })),

      setBdi: (bdi) => set({ bdi }),
      setTitle: (title) => set({ title }),
      setIsProcessing: (isProcessing) => set({ isProcessing }),
      setUploadProgress: (uploadProgress) => set({ uploadProgress }),

      updateData: (rowIndex, columnId, value) => set((state) => {
        const newData = state.tableData.map((row, index) => {
          if (index === rowIndex) {
            const newRow = { ...row, [columnId]: value };
            if (columnId === 'quant' || columnId === 'valorUnit') {
              newRow.total = Number(newRow.quant) * Number(newRow.valorUnit);
            }
            return newRow;
          }
          return row;
        });
        return { tableData: recalculateNumbers(newData) };
      }),

      updateRow: (rowIndex, newRowData) => set((state) => {
        const newData = state.tableData.map((row, index) => {
          if (index === rowIndex) {
            const newRow = { ...row, ...newRowData };
            if ('quant' in newRowData || 'valorUnit' in newRowData) {
              newRow.total = Number(newRow.quant) * Number(newRow.valorUnit);
            }
            if ('codigo' in newRowData && !('ai_status' in newRowData)) {
              newRow.ai_status = 'SUBSTITUIDO';
              newRow.ai_justificativa = 'Item substituído manualmente pelo usuário.';
            }
            return newRow;
          }
          return row;
        });
        return { tableData: recalculateNumbers(newData) };
      }),

      updateItemPosition: (oldIndex, newNumberText) => set((state) => {
        const parts = String(newNumberText).split('.');
        const targetMacro = parseInt(parts[0], 10);
        const targetSub = parts.length > 1 ? parseInt(parts[1], 10) : 0;
        
        if (isNaN(targetMacro)) return state;
        
        let macroCounter = 0;
        let subCounter = 0;
        let targetIndex = -1;
        
        for (let i = 0; i < state.tableData.length; i++) {
            if (state.tableData[i].is_macro_item) {
                macroCounter++;
                subCounter = 0;
            } else {
                subCounter++;
            }
            
            if (macroCounter === targetMacro && subCounter === targetSub) {
                targetIndex = i;
                break;
            }
        }
        
        if (targetIndex === -1) {
            for (let i = state.tableData.length - 1; i >= 0; i--) {
                let mCount = state.tableData.slice(0, i + 1).filter((d: BudgetItem) => d.is_macro_item).length;
                if (mCount === targetMacro) {
                    targetIndex = i;
                    break;
                }
            }
        }
        
        if (targetIndex === -1) return state;
        
        const newData = [...state.tableData];
        if (targetSub === 0 && !newData[oldIndex].is_macro_item) {
            newData[oldIndex] = { ...newData[oldIndex], is_macro_item: true, quant: 0, valorUnit: 0, total: 0, und: "-" };
        } else if (targetSub !== 0 && newData[oldIndex].is_macro_item) {
            newData[oldIndex] = { ...newData[oldIndex], is_macro_item: false, quant: 1 };
        }
        
        return { tableData: moveRowOrBlock(newData, oldIndex, targetIndex) };
      }),

      clearBudget: () => set({ tableData: [], title: 'Orçamento Base', bdi: 25.0 }),
    }),
    {
      name: 'orcamento_data',
      partialize: (state) => ({ tableData: state.tableData, bdi: state.bdi, title: state.title }),
    }
  )
);

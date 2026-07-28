const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'components', 'BudgetTable.tsx');
let content = fs.readFileSync(file, 'utf-8');

const strCellInput = "// Componente isolado para evitar perda de foco";
const strCodigoCell = "export interface CodigoCellProps";
const strAutoCell = "// Componente inteligente que faz a ponte";
const strSortableRow = "const SortableRow = (";
const strBudgetTable = "export function BudgetTable";

const idxCellInput = content.indexOf(strCellInput);
const idxCodigoCell = content.indexOf(strCodigoCell);
const idxAutoCell = content.indexOf(strAutoCell);
const idxSortableRow = content.indexOf(strSortableRow);
const idxBudgetTable = content.indexOf(strBudgetTable);

const cellInputCode = content.substring(idxCellInput, idxCodigoCell);
const codigoCellCode = content.substring(idxCodigoCell, idxAutoCell);
const autoCellCode = content.substring(idxAutoCell, idxSortableRow);
let sortableRowCode = content.substring(idxSortableRow, idxBudgetTable);

const cellsContent = `import React, { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { BudgetItem } from '@/utils/budgetUtils';

${cellInputCode}
${codigoCellCode}
${autoCellCode}`;

const sortableRowContent = `import React, { useState } from "react";
import { useSortable } from '@dnd-kit/sortable';
import { flexRender } from "@tanstack/react-table";
import { List, Box, Wand2, Trash2, ChevronUp, GripVertical, ChevronDown } from "lucide-react";
import { recalculateNumbers } from '@/utils/budgetUtils';

${sortableRowCode.replace('const SortableRow =', 'export const SortableRow = React.memo(').trim()}
);`;

content = content.substring(0, idxCellInput) + content.substring(idxBudgetTable);

const importCells = `import { CellInput, CodigoCell, AutocompleteDescricaoCell } from './BudgetTableCells';
import { SortableRow } from './SortableRow';\n`;

content = content.replace(/import \{ BudgetItem, recalculateNumbers, moveRowOrBlock \} from '@\/utils\/budgetUtils';/, `import { BudgetItem, recalculateNumbers, moveRowOrBlock } from '@/utils/budgetUtils';\n${importCells}`);

fs.writeFileSync(path.join(__dirname, 'src', 'components', 'BudgetTableCells.tsx'), cellsContent);
fs.writeFileSync(path.join(__dirname, 'src', 'components', 'SortableRow.tsx'), sortableRowContent);
fs.writeFileSync(file, content);
console.log("Success");

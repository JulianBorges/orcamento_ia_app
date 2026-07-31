import { z } from "zod";

export const excelRowSchema = z.object({
  descricao: z.string().min(1, "A descrição (ou item) é obrigatória").default("Item sem descrição"),
  quantidade: z.number().default(1.0),
  unidade: z.string().default("-"),
  valorUnit: z.number().default(0.0),
  is_macro_item: z.boolean().default(false),
});

export type ExcelRow = z.infer<typeof excelRowSchema>;

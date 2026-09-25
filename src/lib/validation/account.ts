import { z } from "zod";
import { ACCOUNT_CODE_PATTERN, ACCOUNT_TYPES, ALL_ACCOUNT_SUBTYPES, subtypeMatchesType } from "@/lib/accounting/accounts";

const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.uuid().nullable());

const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v));

export const accountFormSchema = z
  .object({
    id: z.uuid().optional(),
    code: z.string().trim().regex(ACCOUNT_CODE_PATTERN, "code_format"),
    name_ar: z.string().trim().min(1, "required").max(200),
    name_en: optionalText,
    account_type: z.enum(ACCOUNT_TYPES),
    account_subtype: z.enum(ALL_ACCOUNT_SUBTYPES as [string, ...string[]]),
    parent_id: optionalUuid,
    department_id: optionalUuid,
    is_postable: z.boolean(),
    is_active: z.boolean(),
    description: optionalText,
  })
  .refine((v) => subtypeMatchesType(v.account_type, v.account_subtype), {
    path: ["account_subtype"],
    message: "type_mismatch",
  });

export type AccountFormInput = z.input<typeof accountFormSchema>;
export type AccountFormValues = z.output<typeof accountFormSchema>;

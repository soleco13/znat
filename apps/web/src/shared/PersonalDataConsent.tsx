import { Link } from "react-router-dom";

import { Checkbox } from "@/shared/ui/checkbox";

/**
 * Галочка согласия на обработку персональных данных (152-ФЗ). С 01.09.2025
 * согласие оформляется отдельным документом, поэтому галочка ведёт на его
 * текст (`/consent`), а политика и пользовательское соглашение — отдельными
 * ссылками: их принимают самой регистрацией.
 */
export function PersonalDataConsent({
  checked,
  onChange,
  id = "pd-consent",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
}) {
  const link = "font-medium text-primary hover:underline";
  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      <div className="flex items-start gap-2">
        <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
        <label htmlFor={id}>
          Даю{" "}
          <Link to="/consent" target="_blank" className={link}>
            согласие на обработку персональных данных
          </Link>
        </label>
      </div>
      <p className="pl-6">
        Регистрируясь, вы принимаете{" "}
        <Link to="/terms" target="_blank" className={link}>
          пользовательское соглашение
        </Link>{" "}
        и знакомитесь с{" "}
        <Link to="/privacy" target="_blank" className={link}>
          политикой обработки данных
        </Link>
        .
      </p>
    </div>
  );
}

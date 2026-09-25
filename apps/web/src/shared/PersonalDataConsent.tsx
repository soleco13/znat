import { Link } from "react-router-dom";

import { Checkbox } from "@/shared/ui/checkbox";

/** Галочка согласия на обработку персональных данных (152-ФЗ) со ссылкой на политику. */
export function PersonalDataConsent({
  checked,
  onChange,
  id = "pd-consent",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
}) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <label htmlFor={id}>
        Даю согласие на обработку персональных данных в соответствии с{" "}
        <Link to="/privacy" target="_blank" className="font-medium text-primary hover:underline">
          политикой обработки персональных данных
        </Link>
      </label>
    </div>
  );
}

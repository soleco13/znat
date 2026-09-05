import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Тема фиксированная светлая — отдельного theme-провайдера в проекте нет
// (правило CLAUDE.md: без localStorage; тёмная тема не в MVP).
const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast rounded-lg group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-md",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:rounded-md group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:font-semibold",
          cancelButton:
            "group-[.toast]:rounded-md group-[.toast]:bg-secondary group-[.toast]:text-muted-foreground",
          error: "group-[.toaster]:!border-destructive/30 group-[.toaster]:!text-destructive",
          success: "group-[.toaster]:!border-success/30",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };

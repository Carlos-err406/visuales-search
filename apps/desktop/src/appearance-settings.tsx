import { Monitor, Moon, Sun } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AppearanceController } from "./use-appearance";

const appearances = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export function AppearanceSettings({ controller }: { controller: AppearanceController }) {
  return (
    <section className="settings-section settings-appearance" aria-labelledby="appearance-heading">
      <h3 id="appearance-heading">Appearance</h3>
      <div className="settings-row">
        <Label htmlFor="appearance-theme">Theme</Label>
        <Select
          items={appearances}
          value={controller.appearance}
          onValueChange={(value) => {
            if (value === "system" || value === "light" || value === "dark") controller.choose(value);
          }}
        >
          <SelectTrigger id="appearance-theme" aria-describedby={controller.error ? "appearance-error" : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            {appearances.map(({ value, label, icon: Icon }) => (
              <SelectItem key={value} value={value}>
                <Icon size={15} /> {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {controller.error && (
        <p id="appearance-error" className="settings-appearance-error" role="alert">
          {controller.error}
        </p>
      )}
    </section>
  );
}

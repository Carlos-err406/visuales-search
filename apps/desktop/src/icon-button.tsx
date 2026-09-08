import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { createTooltipHandle, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Hint = { title: string; detail?: string };
const TooltipHandleContext = createContext<ReturnType<typeof createTooltipHandle<Hint>> | null>(null);

export function IconTooltipProvider({ children }: { children: ReactNode }) {
  const [handle] = useState(() => createTooltipHandle<Hint>());
  return (
    <TooltipProvider delay={450} closeDelay={120} timeout={400}>
      <TooltipHandleContext.Provider value={handle}>
        {children}
        <Tooltip handle={handle}>
          {({ payload }) => (
            <TooltipContent className="button-tooltip" sideOffset={8}>
              <span className="tooltip-title">{payload?.title}</span>
              {payload?.detail && <span className="tooltip-detail">{payload.detail}</span>}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipHandleContext.Provider>
    </TooltipProvider>
  );
}

type IconButtonProps = Omit<ComponentProps<typeof Button>, "variant"> & {
  label: string;
  tooltip?: string;
  description?: string;
  disabledReason?: string;
  variant?: "plain" | "primary";
};

export function IconButton({
  label,
  tooltip = label,
  description,
  disabledReason,
  disabled,
  variant = "plain",
  children,
  className = "",
  ...props
}: IconButtonProps) {
  const handle = useContext(TooltipHandleContext);
  if (!handle) throw new Error("IconButton requires IconTooltipProvider");
  return (
    <TooltipTrigger
      handle={handle}
      payload={{ title: tooltip, detail: disabled ? disabledReason || description : description }}
      render={
        <Button
          variant={variant === "primary" ? "default" : "ghost"}
          size="icon"
          className={`icon-button ${className}`}
          disabled={disabled}
          focusableWhenDisabled
          aria-label={label}
          aria-description={disabled ? disabledReason || description : description}
          {...props}
        />
      }
    >
      {children}
    </TooltipTrigger>
  );
}

import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
  createPopoverHandle,
} from "@/components/ui/popover";

type Help = { label: string; description: string };
export const createHelpHandle = () => createPopoverHandle<Help>();
type HelpHandle = ReturnType<typeof createHelpHandle>;

export function HelpButton({ label, description, handle }: Help & { handle: HelpHandle }) {
  return (
    <PopoverTrigger
      handle={handle}
      payload={{ label, description }}
      render={<Button variant="ghost" size="icon" className="icon-button help-button" aria-label={label} />}
    >
      <Info size={14} />
    </PopoverTrigger>
  );
}

export function HelpPopover({ handle }: { handle: HelpHandle }) {
  return (
    <Popover handle={handle}>
      {({ payload }) => (
        <PopoverContent className="help-popover">
          <div className="help-popover-heading">
            <PopoverTitle>{payload?.label}</PopoverTitle>
            <PopoverClose
              render={<Button variant="ghost" size="icon" className="icon-button" aria-label="Close help" />}
            >
              <X size={14} />
            </PopoverClose>
          </div>
          <PopoverDescription>{payload?.description}</PopoverDescription>
        </PopoverContent>
      )}
    </Popover>
  );
}

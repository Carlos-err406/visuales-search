import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverTitle = PopoverPrimitive.Title;
const PopoverDescription = PopoverPrimitive.Description;
const PopoverClose = PopoverPrimitive.Close;
const createPopoverHandle = PopoverPrimitive.createHandle;

function PopoverContent(props: PopoverPrimitive.Popup.Props) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={10}
        className="popover-positioner"
      >
        <PopoverPrimitive.Popup data-slot="popover-content" {...props} />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverTitle, PopoverDescription, PopoverClose, createPopoverHandle };

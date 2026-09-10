import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

const Dialog = DialogPrimitive.Root;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

function DialogContent(props: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="preview-backdrop" />
      <DialogPrimitive.Popup data-slot="dialog-content" {...props} />
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogTitle, DialogDescription, DialogContent };

import type { ComponentProps } from 'react';
import { Dialog as Primitive } from 'radix-ui';
export const Dialog = Primitive.Root;
export const DialogClose = Primitive.Close;
export function DialogTitle(props: ComponentProps<typeof Primitive.Title>) {
  return <Primitive.Title data-slot="dialog-title" {...props} />;
}
export function DialogDescription(props: ComponentProps<typeof Primitive.Description>) {
  return <Primitive.Description data-slot="dialog-description" {...props} />;
}
export function DialogContent({
  children,
  showCloseButton: _unused,
  ...props
}: ComponentProps<typeof Primitive.Content> & { showCloseButton?: boolean }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="modal-overlay" />
      <Primitive.Content data-slot="dialog-content" {...props}>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

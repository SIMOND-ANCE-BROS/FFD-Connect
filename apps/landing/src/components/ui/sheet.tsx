import type { ComponentProps } from 'react';
import { Dialog as Primitive } from 'radix-ui';
export const Sheet = Primitive.Root;
export const SheetTrigger = Primitive.Trigger;
export const SheetClose = Primitive.Close;
export function SheetTitle(props: ComponentProps<typeof Primitive.Title>) {
  return <Primitive.Title data-slot="sheet-title" {...props} />;
}
export function SheetDescription(props: ComponentProps<typeof Primitive.Description>) {
  return <Primitive.Description data-slot="sheet-description" {...props} />;
}
export function SheetContent({
  children,
  showCloseButton: _unused,
  ...props
}: ComponentProps<typeof Primitive.Content> & { showCloseButton?: boolean }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="modal-overlay" />
      <Primitive.Content data-slot="sheet-content" {...props}>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

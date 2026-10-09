import type { ComponentProps } from 'react';
import { Accordion as Primitive } from 'radix-ui';
import { ChevronDown } from 'lucide-react';
export const Accordion = Primitive.Root;
export function AccordionItem(props: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item data-slot="accordion-item" {...props} />;
}
export function AccordionTrigger({ children, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Header>
      <Primitive.Trigger data-slot="accordion-trigger" {...props}>
        {children}
        <ChevronDown size={20} aria-hidden="true" />
      </Primitive.Trigger>
    </Primitive.Header>
  );
}
export function AccordionContent(props: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content data-slot="accordion-content" {...props} />;
}

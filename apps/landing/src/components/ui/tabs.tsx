import type { ComponentProps } from 'react';
import { Tabs as Primitive } from 'radix-ui';
export function Tabs(props: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root data-slot="tabs" {...props} />;
}
export function TabsList(props: ComponentProps<typeof Primitive.List>) {
  return <Primitive.List data-slot="tabs-list" {...props} />;
}
export function TabsTrigger(props: ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger data-slot="tabs-trigger" {...props} />;
}
export function TabsContent(props: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content data-slot="tabs-content" {...props} />;
}

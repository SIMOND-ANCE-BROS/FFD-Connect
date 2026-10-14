import { Anchor } from '@mantine/core';
import { Link } from 'react-router';
import { useListReturnPath } from '../lib/listReturn';

/**
 * « Retour à la liste » of a record page (#562): back to the list as it was
 * left in this tab (filters, sort, page). A record whose URL carries its list
 * query (moderation, renewals: `?status=…`) passes it as `search`, which wins:
 * it also works in a tab opened straight on the record.
 */
export function BackToList({ listPath, search = '' }: { listPath: string; search?: string }) {
  const remembered = useListReturnPath(listPath);
  return (
    <Anchor component={Link} to={search ? `${listPath}${search}` : remembered}>
      Retour à la liste
    </Anchor>
  );
}

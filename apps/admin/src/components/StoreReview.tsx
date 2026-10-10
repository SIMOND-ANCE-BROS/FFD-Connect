import { Alert, Badge, Button, Group, Modal, Stack, Text } from '@mantine/core';
import {
  STORE_REVIEW_LABEL,
  storeReviewMessage,
  type ProtectedAction,
  type StoreReviewTarget,
} from '../lib/storeReview';

/** Small marker for list rows. */
export function StoreReviewBadge() {
  return (
    <Badge color="grape" variant="light" ml="xs" title={STORE_REVIEW_LABEL}>
      Validation stores
    </Badge>
  );
}

/** Notice at the top of a detail page. */
export function StoreReviewNotice({ target }: { target: StoreReviewTarget }) {
  return (
    <Alert color="grape" title={STORE_REVIEW_LABEL}>
      {target === 'user'
        ? 'Les relecteurs Apple et Google se connectent avec ce compte pour valider les mises à jour de l’application. Sa fiche reste modifiable, mais il ne peut être ni supprimé ni désactivé.'
        : 'Ce club est rattaché au compte utilisé par les relecteurs Apple et Google. Sa fiche reste modifiable, mais il ne peut être ni supprimé ni désactivé.'}
    </Alert>
  );
}

/** Shown instead of the delete / disable flow, which would only get a 403. */
export function StoreReviewBlockedModal({
  target,
  action,
  onClose,
}: {
  target: StoreReviewTarget;
  action: ProtectedAction | null;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={action !== null}
      onClose={onClose}
      title={action === 'delete' ? 'Suppression impossible' : 'Désactivation impossible'}
    >
      <Stack>
        {action && <Text size="sm">{storeReviewMessage(target, action)}</Text>}
        <Group justify="flex-end">
          <Button onClick={onClose}>Compris</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

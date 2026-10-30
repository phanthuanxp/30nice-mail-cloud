export type MessageFlagAction = 'seen' | 'unseen' | 'flagged' | 'unflagged';

export function updateMessageFlagState<T extends { seen: boolean; flagged: boolean }>(
  current: T,
  action: MessageFlagAction,
): Pick<T, 'seen' | 'flagged'> {
  return {
    seen: action === 'seen' ? true : action === 'unseen' ? false : current.seen,
    flagged: action === 'flagged' ? true : action === 'unflagged' ? false : current.flagged,
  };
}

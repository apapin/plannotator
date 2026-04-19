import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { ParticipantAvatars } from './ParticipantAvatars';
import type { PresenceState } from '@plannotator/shared/collab';

function peer(name: string, color = '#abc'): PresenceState {
  return {
    user: { id: name.toLowerCase(), name, color },
    cursor: null,
  };
}

describe('ParticipantAvatars', () => {
  test('returns null with no peers', () => {
    const { container } = render(<ParticipantAvatars remotePresence={{}} />);
    expect(container.querySelector('[data-testid="participant-avatars"]')).toBeNull();
  });

  test('renders one avatar per peer with correct initial', () => {
    const { container } = render(
      <ParticipantAvatars remotePresence={{ c1: peer('Alice'), c2: peer('Bob') }} />,
    );
    const avatars = container.querySelectorAll('[data-participant-id]');
    expect(avatars.length).toBe(2);
    const initials = Array.from(avatars).map(a => a.textContent);
    expect(initials).toEqual(['A', 'B']);  // sorted by name
  });

  test('collapses extras above maxVisible into "+N"', () => {
    const presence: Record<string, PresenceState> = {};
    for (let i = 0; i < 6; i++) {
      presence[`c${i}`] = peer(String.fromCharCode(65 + i));
    }
    const { container } = render(
      <ParticipantAvatars remotePresence={presence} maxVisible={3} />,
    );
    expect(container.querySelectorAll('[data-participant-id]').length).toBe(3);
    const overflow = container.querySelector('[data-testid="participant-overflow"]');
    expect(overflow?.textContent).toBe('+3');
  });

  test('overflow title lists names not shown', () => {
    const presence = {
      c1: peer('Alice'), c2: peer('Bob'), c3: peer('Charlie'), c4: peer('Dana'), c5: peer('Eve'),
    };
    const { container } = render(
      <ParticipantAvatars remotePresence={presence} maxVisible={2} />,
    );
    const overflow = container.querySelector('[data-testid="participant-overflow"]');
    expect(overflow?.getAttribute('title')).toBe('Charlie, Dana, Eve');
  });

  test('falls back to "?" initial when name is blank', () => {
    const { container } = render(
      <ParticipantAvatars remotePresence={{ c1: peer('') }} />,
    );
    const avatars = container.querySelectorAll('[data-participant-id]');
    expect(avatars[0].textContent).toBe('G');  // falls through to "Guest" → "G"
  });
});

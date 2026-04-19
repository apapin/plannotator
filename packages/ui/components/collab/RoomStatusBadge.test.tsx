import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { RoomStatusBadge } from './RoomStatusBadge';

function label(el: HTMLElement): string {
  const badge = el.querySelector('[data-testid="room-status-badge"]');
  return badge?.getAttribute('data-status-label') ?? '';
}

describe('RoomStatusBadge', () => {
  test('renders "Live" when active and authenticated', () => {
    const { container } = render(
      <RoomStatusBadge connectionStatus="authenticated" roomStatus="active" />,
    );
    expect(label(container)).toBe('Live');
  });

  test('renders "Connecting" during connecting/authenticating', () => {
    const { container, rerender } = render(
      <RoomStatusBadge connectionStatus="connecting" roomStatus={null} />,
    );
    expect(label(container)).toBe('Connecting');
    rerender(<RoomStatusBadge connectionStatus="authenticating" roomStatus={null} />);
    expect(label(container)).toBe('Connecting');
  });

  test('renders "Reconnecting" during reconnect', () => {
    const { container } = render(
      <RoomStatusBadge connectionStatus="reconnecting" roomStatus="active" />,
    );
    expect(label(container)).toBe('Reconnecting');
  });

  test('renders "Offline" when disconnected or closed', () => {
    const { container, rerender } = render(
      <RoomStatusBadge connectionStatus="disconnected" roomStatus={null} />,
    );
    expect(label(container)).toBe('Offline');
    rerender(<RoomStatusBadge connectionStatus="closed" roomStatus={null} />);
    expect(label(container)).toBe('Offline');
  });

  test('prioritizes "Locked" over connection states', () => {
    const { container } = render(
      <RoomStatusBadge connectionStatus="authenticated" roomStatus="locked" />,
    );
    expect(label(container)).toBe('Locked');
  });

  test('prioritizes "Room deleted" above all', () => {
    const { container } = render(
      <RoomStatusBadge connectionStatus="reconnecting" roomStatus="deleted" />,
    );
    expect(label(container)).toBe('Room deleted');
  });

  test('prioritizes "Expired" above connection states but below deleted', () => {
    const { container } = render(
      <RoomStatusBadge connectionStatus="reconnecting" roomStatus="expired" />,
    );
    expect(label(container)).toBe('Expired');
  });
});

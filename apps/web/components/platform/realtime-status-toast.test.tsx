import { act, render, screen } from '@testing-library/react';

import { RealtimeStatusToast } from './realtime-status-toast';

/** Emit event yang sama dengan useRealtime() tanpa menyentuh SSE/backoff. */
function emitRealtime(connected: boolean) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent('cq:realtime', { detail: { connected } }),
    );
  });
}

describe('RealtimeStatusToast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('tidak menampilkan apa pun saat koneksi normal', () => {
    render(<RealtimeStatusToast />);
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('reconnect cepat (dalam grace) → tidak ada notifikasi sama sekali', () => {
    render(<RealtimeStatusToast />);

    emitRealtime(false);
    // Belum lewat grace.
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();

    // Reconnect sebelum grace habis.
    emitRealtime(true);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('terputus melewati grace → muncul "Reconnecting…"', () => {
    render(<RealtimeStatusToast />);

    emitRealtime(false);
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2600);
    });
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
  });

  it('connected:false berulang tidak membuat duplikat toast/timer', () => {
    render(<RealtimeStatusToast />);

    emitRealtime(false);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    // Event berulang saat grace berjalan → tetap satu timer.
    emitRealtime(false);
    emitRealtime(false);
    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(screen.getAllByText('Reconnecting…')).toHaveLength(1);

    // Berulang saat sudah tampil → tetap satu.
    emitRealtime(false);
    emitRealtime(false);
    expect(screen.getAllByText('Reconnecting…')).toHaveLength(1);
  });

  it('reconnect setelah toast tampil → "Connected" singkat lalu hilang', () => {
    render(<RealtimeStatusToast />);

    emitRealtime(false);
    act(() => {
      jest.advanceTimersByTime(2600);
    });
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();

    emitRealtime(true);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1300);
    });
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('tetap "Reconnecting…" bila gagal berulang (tidak escalate)', () => {
    render(<RealtimeStatusToast />);

    emitRealtime(false);
    act(() => {
      jest.advanceTimersByTime(2600);
    });
    for (let i = 0; i < 5; i++) emitRealtime(false);
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.getAllByText('Reconnecting…')).toHaveLength(1);
  });

  it('cleanup: unmount membersihkan listener (event setelah unmount aman)', () => {
    const { unmount } = render(<RealtimeStatusToast />);
    unmount();
    expect(() => emitRealtime(false)).not.toThrow();
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
  });
});

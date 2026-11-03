import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import OptionsPage from '../components/OptionsPage';
import { settingsAPI } from '../services/api';
import { DEFAULT_USER_OPTIONS } from '../types';

// B54 contract (D83), web parity with mobile's B50:
//   - OptionsPage gains a "Pomodoro" section with four number inputs,
//     `data-testid` `pomodoro-work`, `pomodoro-break`, `pomodoro-long-break`,
//     `pomodoro-long-every`, loaded on mount from `settingsAPI.getPomodoro()`
//     (OptionsPage fetches it itself; the web app has no react-query).
//   - A Save button (`data-testid="pomodoro-save"`) sends all four, as numbers,
//     through `settingsAPI.updatePomodoro({ work_minutes, break_minutes,
//     long_break_minutes, long_break_every })`.
//   - A minutes value outside 1–180 (1–12 for the count, or not a whole
//     number) disables Save and shows the range text `1–180` (`1–12`, en dash)
//     under that field; the text is absent while the value is in range.
//   - A failed load shows the defaults 25/5/15/4 (inputs disabled, greyed),
//     the text "Couldn't load", and Save stays disabled.
vi.mock('../services/api', () => ({
  settingsAPI: { getPomodoro: vi.fn(), updatePomodoro: vi.fn() },
}));

const mockedGet = settingsAPI.getPomodoro as Mock;
const mockedUpdate = settingsAPI.updatePomodoro as Mock;

const SERVER_POMODORO = { work_minutes: 50, break_minutes: 10, long_break_minutes: 30, long_break_every: 3 };

function renderOptions() {
  return render(<OptionsPage options={DEFAULT_USER_OPTIONS} onChange={vi.fn()} />);
}

function field(testId: string) {
  return screen.getByTestId(testId) as HTMLInputElement;
}

async function loaded() {
  renderOptions();
  await waitFor(() => expect(field('pomodoro-work').value).toBe('50'));
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedUpdate.mockReset();
  mockedGet.mockResolvedValue(SERVER_POMODORO);
  mockedUpdate.mockImplementation(async (s: unknown) => s);
});

describe('Pomodoro lengths in Options (B54)', () => {
  it("fields show the server's values and Save sends the edited four", async () => {
    await loaded();
    expect(mockedGet).toHaveBeenCalled();
    expect(field('pomodoro-break').value).toBe('10');
    expect(field('pomodoro-long-break').value).toBe('30');
    expect(field('pomodoro-long-every').value).toBe('3');
    expect(screen.getByTestId('pomodoro-save')).not.toBeDisabled();

    fireEvent.change(field('pomodoro-work'), { target: { value: '40' } });
    fireEvent.change(field('pomodoro-long-every'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('pomodoro-save'));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith({
        work_minutes: 40,
        break_minutes: 10,
        long_break_minutes: 30,
        long_break_every: 4,
      }),
    );
  });

  it('0 minutes disables Save and shows the range', async () => {
    await loaded();
    expect(screen.queryByText('1–180')).toBeNull();

    fireEvent.change(field('pomodoro-break'), { target: { value: '0' } });
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();
    expect(screen.getByText('1–180')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pomodoro-save'));
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('181 minutes disables Save; 180 enables it again', async () => {
    await loaded();
    fireEvent.change(field('pomodoro-long-break'), { target: { value: '181' } });
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();
    expect(screen.getByText('1–180')).toBeInTheDocument();

    fireEvent.change(field('pomodoro-long-break'), { target: { value: '180' } });
    expect(screen.getByTestId('pomodoro-save')).not.toBeDisabled();
    expect(screen.queryByText('1–180')).toBeNull();
  });

  it('long break every outside 1–12 disables Save and shows its range', async () => {
    await loaded();
    fireEvent.change(field('pomodoro-long-every'), { target: { value: '13' } });
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();
    expect(screen.getByText('1–12')).toBeInTheDocument();

    fireEvent.change(field('pomodoro-long-every'), { target: { value: '0' } });
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();

    fireEvent.change(field('pomodoro-long-every'), { target: { value: '12' } });
    expect(screen.getByTestId('pomodoro-save')).not.toBeDisabled();
  });

  it("load failure shows the defaults, \"Couldn't load\", and keeps Save disabled", async () => {
    mockedGet.mockRejectedValue(new Error('Network Error'));
    renderOptions();

    await screen.findByText("Couldn't load");
    expect(field('pomodoro-work').value).toBe('25');
    expect(field('pomodoro-break').value).toBe('5');
    expect(field('pomodoro-long-break').value).toBe('15');
    expect(field('pomodoro-long-every').value).toBe('4');
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();

    fireEvent.click(screen.getByTestId('pomodoro-save'));
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});

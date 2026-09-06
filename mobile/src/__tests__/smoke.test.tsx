import { renderRouter } from 'expo-router/testing-library';

describe('app shell', () => {
  it('renders the tabs layout with the four build-1 tabs', async () => {
    const router = renderRouter('src/app', { initialUrl: '/' });
    const view = await router;

    expect(router.getPathname()).toBe('/');
    expect((await view.findAllByText('Stopwatch')).length).toBeGreaterThan(0);
    expect(view.getAllByText('Activities').length).toBeGreaterThan(0);
    expect(view.getAllByText('Recordings').length).toBeGreaterThan(0);
    expect(view.getAllByText('Schedule').length).toBeGreaterThan(0);
  });
});

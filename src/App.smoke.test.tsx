import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the chess core heading', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /chess decision trainer/i })).toBeInTheDocument();
});

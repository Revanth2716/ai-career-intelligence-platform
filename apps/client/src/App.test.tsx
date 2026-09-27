import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from './auth/auth-context';
import { LoginPage } from './pages/login';

function renderLogin() {
  return render(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
  );
}

describe('LoginPage', () => {
  it('renders sign-in form and switches to register mode', async () => {
    renderLogin();
    expect(screen.getByText('Sign in')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Need an account? Register'));
    expect(screen.getByText('Create account')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('enforces the 10-character password minimum from the shared contract', () => {
    renderLogin();
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('minlength', '10');
  });
});

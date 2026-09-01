import { asyncHandler } from '../utils/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import * as authService from '../services/auth.service.js';

export const login = asyncHandler(async (req, res) => {
  const { email, password } = validateBody(req, ['email', 'password']);
  const result = await authService.login(email, password);
  res.json(result);
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.user.id);
  res.json({ user });
});

import { prisma } from "../../config/prisma";
import { AppError } from "../../common/errors";
import { toPublicUser } from "../auth/auth.service";

export async function getCurrentUser(userId: string) {
  // Always re-read from Postgres rather than trusting the access token's
  // claims. A token minted minutes ago can't reflect a removal, role
  // change, or reassignment that happened since — see master spec §15.
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError("USER_NOT_FOUND", "User not found");
  }
  return toPublicUser(user);
}

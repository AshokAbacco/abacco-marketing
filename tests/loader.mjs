export async function resolve(specifier, context, next) {
  if (specifier === "@prisma/client") return { url: new URL("./fake-prisma.mjs", import.meta.url).href, shortCircuit: true };
  if (specifier === "nodemailer") return { url: new URL("./fake-nodemailer.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}

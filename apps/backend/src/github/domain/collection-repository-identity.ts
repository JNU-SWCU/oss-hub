export const splitNameWithOwner = (nameWithOwner: string): [string, string] => {
  const index = nameWithOwner.indexOf('/');
  if (index < 0) {
    throw new Error(
      `invalid collection repository nameWithOwner: ${nameWithOwner}`,
    );
  }
  return [nameWithOwner.slice(0, index), nameWithOwner.slice(index + 1)];
};

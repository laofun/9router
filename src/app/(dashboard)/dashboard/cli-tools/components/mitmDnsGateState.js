export function getMitmDnsGateState({ hasCachedPassword, status } = {}) {
  const isWindows = status?.isWindows === true;
  const isAdmin = status?.isAdmin !== false;
  const needsSudoPassword = !isWindows && !hasCachedPassword;
  const dnsToggleBlocked = isWindows && !isAdmin;

  return {
    isWindows,
    isAdmin,
    needsSudoPassword,
    dnsToggleBlocked,
  };
}

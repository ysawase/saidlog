const GUEST_ID_KEY = 'saidlog_guest_id';

function generateGuestId() {
  return 'guest_' + crypto.randomUUID();
}

export function getOrCreateGuestId() {
  let guestId = localStorage.getItem(GUEST_ID_KEY);
  if (!guestId) {
    guestId = generateGuestId();
    localStorage.setItem(GUEST_ID_KEY, guestId);
  }
  return guestId;
}

export function clearGuestId() {
  localStorage.removeItem(GUEST_ID_KEY);
}

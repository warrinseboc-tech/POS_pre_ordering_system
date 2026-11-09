/* Account-specific picture controls shared by customer and crew profiles. */
(() => {
  const crew = location.pathname.startsWith('/crew/');
  const mount = () => {
    const form = document.getElementById(crew ? 'profileForm' : 'customerProfileForm');
    if (!form || form.dataset.pictureReady) return;
    form.dataset.pictureReady = 'true';
    const avatar = form.querySelector(crew ? '.avatar' : '.profile-avatar');
    if (!avatar) return;
    const controls = document.createElement('div');
    controls.className = 'profile-picture-controls';
    const label = document.createElement('label');
    label.className = 'field';
    label.textContent = 'Profile picture';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    label.append(input);
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'outline';
    save.textContent = 'Save picture';
    save.disabled = true;
    const status = document.createElement('p');
    status.className = 'mini-note';
    status.setAttribute('role', 'status');
    status.textContent = 'JPG, PNG, or WebP · Up to 5 MB';
    controls.append(label, save, status);
    (form.querySelector(crew ? '.profile-header' : '.profile-avatar-wrap')).after(controls);
    const show = blob => {
      if (!avatar.isConnected) return;
      const image = document.createElement('img');
      image.alt = 'Your profile picture';
      image.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      const url = URL.createObjectURL(blob);
      image.onload = image.onerror = () => URL.revokeObjectURL(url);
      image.src = url;
      avatar.replaceChildren(image);
    };
    fetch('/api/profile-picture', {headers: {'X-Portal': crew ? 'crew' : 'customer'}, credentials: 'same-origin'})
      .then(response => response.ok ? response.blob() : null).then(blob => { if (blob && !input.files.length) show(blob); }).catch(() => {});
    input.onchange = () => {
      const file = input.files[0];
      save.disabled = true;
      if (!file) return;
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        status.textContent = 'Choose a JPG, PNG, or WebP picture smaller than 5 MB.';
        input.value = '';
        return;
      }
      show(file);
      save.disabled = false;
      status.textContent = 'Preview only. Click Save picture to upload.';
    };
    save.onclick = async () => {
      const data = new FormData();
      if (!input.files[0]) return;
      data.append('image', input.files[0]);
      save.disabled = true;
      input.disabled = true;
      status.textContent = 'Uploading picture…';
      try {
        await Istilo.api('/profile-picture', {method: 'POST', body: data});
        status.textContent = 'Profile picture saved.';
      } catch (error) {
        status.textContent = error.message;
        save.disabled = false;
      } finally { input.disabled = false; }
    };
  };
  new MutationObserver(mount).observe(document.body, {childList: true, subtree: true});
  mount();
})();

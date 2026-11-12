// Keep tokens in component memory. Never persist link credentials or include them in diagnostics.
export function authenticationLinkValues(values: {
  userName?: string | string[];
  token?: string | string[];
}) {
  return {
    userName:
      typeof values.userName === 'string' && values.userName.length <= 256 ? values.userName : '',
    token: typeof values.token === 'string' && values.token.length <= 4096 ? values.token : '',
  };
}

export function readAuthenticationFragment(fragment: string) {
  const values = new URLSearchParams(fragment.replace(/^[#?]/, ''));
  return authenticationLinkValues({
    userName: values.getAll('userName').length === 1 ? values.get('userName')! : undefined,
    token: values.getAll('token').length === 1 ? values.get('token')! : undefined,
  });
}

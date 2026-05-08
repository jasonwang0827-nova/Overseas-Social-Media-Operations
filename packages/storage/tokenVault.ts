export interface TokenVault {
  getToken(accountId: string): Promise<string | null>;
}

export const mockTokenVault: TokenVault = {
  async getToken() {
    return null;
  }
};

export interface TeamsConnection {
  userId: string;
  email: string;
  msUserId?: string;
  isActive: boolean;
}

export interface TeamsToken {
  userId: string;
  refreshToken: string;
}

export interface TeamsMeetingMapping {
  userId: string;
  keyword: string;
  companyName: string;
}

export interface GraphTranscript {
  id: string;
  createdDateTime: string;
}

export interface GraphMeeting {
  id: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  participants: {
    organizer?: { identity?: { user?: { id?: string } } };
  };
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

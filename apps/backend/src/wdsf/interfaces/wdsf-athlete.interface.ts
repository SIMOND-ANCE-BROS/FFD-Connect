export interface WdsfAthleteResponse {
  min: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  nationality: string;
  status: string;
  ageGroup: string;
  gender: string;
  country?: {
    name: string;
  };
  memberBody?: {
    name: string;
  };
}

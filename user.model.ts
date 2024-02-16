import { UserRole } from '@shared/models/role.model'
import { BaseModel } from '@shared/models/base.model'
import { Client } from '@shared/models/client.model'
import { Team, TeamType } from './team.model'
import { Timezone } from './timezone.model'
import { Permission } from './permission.model'
import { UserGroup } from './user-group.model'

export class User extends BaseModel {
  allTeamsPermissions: boolean
  billingPlanId: number
  blockingMessage: string | null
  client: Client
  clientId: string
  teamPermission: TeamPermission[]
  createdByName: string
  createdAt: string
  driverId: string
  driverSensorId: string
  email: string
  id: string
  is2FaEnabled: boolean
  isBlocked: boolean
  lastLoggedAt: string
  managedTeams: ManagedTeam[] | null
  name: string
  phone: string
  picture: string | null
  position: string
  userGroups: UserGroup[]
  resellerId?: number | null
  role: UserRole
  isDualAccount: boolean
  driverRouteScope: string
  status: UserStatus
  surname: string
  team: Team
  teamType: TeamType
  updatedBy: Pick<User, 'fullName' | 'id' | 'email' | 'teamType'>
  updatedAt: string
  userName: string
  timezone: Timezone
  keyContactId: string | number
  permissions: Permission[]
  plan: UserPlan | null
  dateFormat: string | null
  language: string

  get fullName(): string {
    return `${this.name} ${this.surname}`
  }

  isClient(): boolean {
    return this.teamType === TeamType.Client
  }

  isAdmin(): boolean {
    return this.teamType === TeamType.Admin
  }

  isDeleted(): boolean {
    return this.status === UserStatus.Deleted
  }

  isArchived(): boolean {
    return this.status === UserStatus.Archived
  }

  isReseller(): boolean {
    return this.teamType === TeamType.Reseller
  }

  constructor(user: Partial<User>) {
    super(user)
    if (!this.picture?.includes(this.fileUrl)) {
      this.picture = this.picture && this.fileUrl + this.picture
    }
  }
}

export interface TeamPermission {
  id: number
  type: TeamType
  clientId: number
  clientName: string
}

export interface ManagedTeam {
  id: number
  type: TeamType
  clientName: string
}

export interface UserPlan {
  id: number
  name: string
  displayName: string
}

export enum UserStatus {
  New = 'new',
  Active = 'active',
  Blocked = 'blocked',
  Deleted = 'deleted',
  Archived = 'archive',
}

export type InputAdminTeamUser = Pick<
  User,
  'email' | 'name' | 'surname' | 'phone' | 'isBlocked' | 'blockingMessage' | 'allTeamsPermissions'
> & { roleId: number; teamPermissions: number[] }

export type UserInListModel = {
  fullName?: string
} & Pick<User, 'id' | 'name' | 'surname' | 'team' | 'picture'>

export class UserInList extends User implements UserInListModel {
  picture: string

  constructor(props: UserInListModel) {
    delete props.fullName
    super(props)
    this.picture = props.picture && this.createPictureUrl(props.picture)
  }

  private createPictureUrl(url: string): string {
    return url.includes(this.fileUrl) ? url : this.fileUrl + url
  }
}

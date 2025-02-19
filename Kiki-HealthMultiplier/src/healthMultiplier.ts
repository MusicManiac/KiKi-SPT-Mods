import type { DependencyContainer } from "tsyringe"
import type { ILogger } from "@spt-aki/models/spt/utils/ILogger"
import type { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod"
import type { IPreAkiLoadMod } from "@spt-aki/models/external/IPreAkiLoadMod"
import type { DatabaseServer } from "@spt-aki/servers/DatabaseServer"
import type { ProfileHelper } from "@spt-aki/helpers/ProfileHelper"
import type { StaticRouterModService } from "@spt-aki/services/mod/staticRouter/StaticRouterModService"

class HealthMultiplier implements IPreAkiLoadMod, IPostDBLoadMod
{
  private container: DependencyContainer
  private config = require("../config/config.json")
  private logger :ILogger
  private bossDictionary = {
    "bossgluhar": "Gluhar",
    "bosskojaniy": "Shturman",
    "bosssanitar": "Sanitar",
    "bossbully": "Reshala",
    "bosskilla": "Killa",
    "bosstagilla": "Tagilla",
    "sectantpriest": "Cultist",
    "bossknight" : "Knight",
    "followerbigpipe" : "BigPipe",
    "followerbirdeye" : "BirdEye",
    "bosszryachiy": "Zryachiy"
  }
  private GPlayerHealth

  /**
   * Loops through bots and sends each to be set to the corresponding config option
   * @param container container
   */
  public postDBLoad(container: DependencyContainer):void
  {    
    this.container = container
    this.logger = this.container.resolve<ILogger>("WinstonLogger")
    const botTypes = this.container.resolve<DatabaseServer>("DatabaseServer").getTables().bots.types
    const globals = this.container.resolve<DatabaseServer>("DatabaseServer").getTables().globals
    const playerHealth = globals.config.Health.ProfileHealthSettings.BodyPartsSettings
    this.GPlayerHealth = playerHealth
    for (let eachBot in botTypes)
    {
      for (let eachHPSet in botTypes[eachBot].health.BodyParts)
      {
        let thisBot = botTypes[eachBot].health.BodyParts[eachHPSet]

        if (this.config.AllEqualToPlayer == true)
        {
          this.setBotHealthToPlayers(thisBot, playerHealth)
        }
        else
        {
          let type = this.findBotType(eachBot, botTypes)
          let configOption = type === "Boss" ? this.config.Boss[this.bossDictionary[eachBot]] : this.config[type]
          this.setBotHealth(thisBot, configOption)                      
        }
      }
    }
  }

  /**
   * Sets routes to set the profile at game start, scav before raid start, and revert back to default on logout
   * @param container container
   */
  public preAkiLoad(container: DependencyContainer):void
  {
    this.container = container
    const staticRouterModService = this.container.resolve<StaticRouterModService>("StaticRouterModService")

    staticRouterModService.registerStaticRouter(
      "SetPlayerHealth",
      [{
        url: "/client/game/start",
        action: (url :string, info :any, sessionId :string, output :string) => 
        {
          const globals = this.container.resolve<DatabaseServer>("DatabaseServer").getTables().globals
          const profileHelper = this.container.resolve<ProfileHelper>("ProfileHelper")
          const playerHealth = globals.config.Health.ProfileHealthSettings.BodyPartsSettings

          this.checkProfileHealth(profileHelper.getPmcProfile(sessionId), playerHealth)
          return output
        }
      }], "aki"
    )
  
    staticRouterModService.registerStaticRouter(
      "SetPlayerScavHealth",
      [{
        url: "/client/customization", //had to find a route between scav being regenerated, and loaded into the match
        action: (url :string, info :any, sessionId :string, output :string) => 
        {
          const globals = this.container.resolve<DatabaseServer>("DatabaseServer").getTables().globals
          const profileHelper = this.container.resolve<ProfileHelper>("ProfileHelper")
          const playerHealth = globals.config.Health.ProfileHealthSettings.BodyPartsSettings

          this.checkProfileHealth(profileHelper.getScavProfile(sessionId), playerHealth)
          return output
        }
      }], "aki"
    )

    staticRouterModService.registerStaticRouter(
      "RevertPlayerHealth",
      [{
        url: "/client/game/logout",
        action: (url :string, info :any, sessionId :string, output :string) => 
        {
          const profileHelper = this.container.resolve<ProfileHelper>("ProfileHelper")

          this.revertProfileHealth(profileHelper.getPmcProfile(sessionId), this.GPlayerHealth)
          this.revertProfileHealth(profileHelper.getScavProfile(sessionId), this.GPlayerHealth)
          return output
        }
      }], "aki"
    )
  }

  /**
   * Checks the profile has been created then sends to setProfileHealth
   * @param target pmc or scav profile
   * @param playerHealth container/playerHealth
   */
  private checkProfileHealth(target :any, playerHealth :any):void
  {
    if (target.Health)
    {
      if (this.config.Player.enabled === true)
      {
        this.setProfileHealth(target, playerHealth)
      }
    }
    else
    {
      this.logger.log(`[Kiki-HealthMultiplier] : Warning, player health values will not be applied on the first run with a fresh profile.\nPlease reboot the game after you have created your character`, "yellow", "red")
    }
  }

  /**
   * Sets health in pmc or scav profile to corresponding config options
   * @param target pmc or scav profile
   * @param playerHealth container/playerHealth
   */
  private setProfileHealth(target :any, playerHealth :any):void
  {
    for (let eachPart in target.Health.BodyParts)
    {
      let thisPart = target.Health.BodyParts[eachPart]

      if (this.config.Player.bodyPartMode.enabled === true)
      {
        thisPart.Health.Current = this.config.Player.bodyPartMode[eachPart]
        thisPart.Health.Maximum = this.config.Player.bodyPartMode[eachPart]
      }
      else
      {
        thisPart.Health.Current = Math.ceil(playerHealth[eachPart].Maximum * this.config.Player.healthMultiplier)
        thisPart.Health.Maximum = Math.ceil(playerHealth[eachPart].Maximum * this.config.Player.healthMultiplier)
      }
    }
  }

  /**
   * Reverts players health back to original values
   * Credit to MaxBIT for the idea from https://hub.sp-tarkov.com/files/file/667-hiwl/
   * @param target pmc or scav profile
   * @param playerHealth container/playerHealth
   */
  private revertProfileHealth(target :any, playerHealth :any):void
  {
    if (target.Health)
    {
      for(let eachPart in target.Health.BodyParts)
      {
        let thisPart = target.Health.BodyParts[eachPart]
        thisPart.Health.Current = playerHealth[eachPart].Maximum
        thisPart.Health.Maximum = playerHealth[eachPart].Maximum
      }
    }    
  }

  /**
   * Finds the type of bot to target with the config
   * @param input bot name
   * @param botTypes container/bots/types
   * @returns type of bot
   */
  private findBotType(input :string, botTypes :any):string
  {
    return input === "bosstest" || input === "test" ? "PMC" :
      input === "assault" || input === "marksman" ? "Scav" :
      input === "pmcbot" ? "Raider" :
      input === "exusec" ? "Rogue" :
      botTypes[input].experience.reward.min >= 1000 ? "Boss" :
      "Follower"    
  }

  /**
 * Sets bot health to corresponding config options
 * @param bot bot
 * @param configOptions config options
 */
  private setBotHealth(bot :any, configOptions :any):void
  {
    for (let eachPart in bot)
    {
      if (configOptions.bodyPartMode.enabled === true)
      {
        bot[eachPart].min = configOptions.bodyPartMode[eachPart]
        bot[eachPart].max = configOptions.bodyPartMode[eachPart]
      }
      else
      {
        bot[eachPart].min *= configOptions.healthMultiplier
        bot[eachPart].max *= configOptions.healthMultiplier
      }
    }
  }

  /**
   * Sets bots health to be equal to that of the players
   * @param thisBot bot to change
   * @param playerHealth container/playerHealth
   */
  private setBotHealthToPlayers(thisBot :any, playerHealth :any):void
  {
    for (let eachPart in thisBot)
    {
      if (this.config.Player.bodyPartMode.enabled == true)
      {
        thisBot[eachPart].min = this.config.Player.bodyPartMode[eachPart]
        thisBot[eachPart].max = this.config.Player.bodyPartMode[eachPart]
      }
      else
      {
        thisBot[eachPart].min = Math.ceil(playerHealth[eachPart].Maximum * this.config.Player.healthMultiplier)
        thisBot[eachPart].max = Math.ceil(playerHealth[eachPart].Maximum * this.config.Player.healthMultiplier)
      }
    }
  }
}

module.exports = {mod: new HealthMultiplier()}
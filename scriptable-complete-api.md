# Complete Scriptable API Reference

This document contains comprehensive API documentation for Scriptable, extracted from the official documentation. It includes every class, method, property, parameter, and code example.

## Table of Contents

- [Alert](#alert)
- [Calendar](#calendar)
- [CalendarEvent](#calendarevent)
- [CallbackURL](#callbackurl)
- [Color](#color)
- [Contact](#contact)
- [ContactsContainer](#contactscontainer)
- [ContactsGroup](#contactsgroup)
- [Data](#data)
- [DateFormatter](#dateformatter)
- [DatePicker](#datepicker)
- [Device](#device)
- [Dictation](#dictation)
- [DocumentPicker](#documentpicker)
- [DrawContext](#drawcontext)
- [FileManager](#filemanager)
- [Font](#font)
- [Image](#image)
- [Keychain](#keychain)
- [LinearGradient](#lineargradient)
- [ListWidget](#listwidget)
- [Location](#location)
- [Mail](#mail)
- [Message](#message)
- [Notification](#notification)
- [Pasteboard](#pasteboard)
- [Path](#path)
- [Photos](#photos)
- [Point](#point)
- [QuickLook](#quicklook)
- [Rect](#rect)
- [RecurrenceRule](#recurrencerule)
- [RelativeDateTimeFormatter](#relativedatetimeformatter)
- [Reminder](#reminder)
- [Request](#request)
- [SFSymbol](#sfsymbol)
- [Safari](#safari)
- [Script](#script)
- [ShareSheet](#sharesheet)
- [Size](#size)
- [Speech](#speech)
- [TextField](#textfield)
- [Timer](#timer)
- [UITable](#uitable)
- [UITableCell](#uitablecell)
- [UITableRow](#uitablerow)
- [URLScheme](#urlscheme)
- [UUID](#uuid)
- [WebView](#webview)
- [WidgetDate](#widgetdate)
- [WidgetImage](#widgetimage)
- [WidgetSpacer](#widgetspacer)
- [WidgetStack](#widgetstack)
- [WidgetText](#widgettext)
- [XMLParser](#xmlparser)
- [args](#args)
- [config](#config)
- [console](#console)
- [importModule](#importmodule)
- [module](#module)

---

## Alert

### Instance Methods

#### `presentAlert`

Instance method presentAlert

#### `textFieldValue`

Instance method textFieldValue

#### `addCancelAction`

Instance method addCancelAction

#### `addTextField`

Instance method addTextField

#### `present`

Instance method present

#### `addDestructiveAction`

Instance method addDestructiveAction

#### `addSecureTextField`

Instance method addSecureTextField

#### `presentSheet`

Instance method presentSheet

#### `addAction`

Instance method addAction

#### `new Alert`

Instance method new Alert

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `message`

Property message

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `TextField`

Property TextField

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `title`

Property title

#### `Path`

Property Path

#### `Message`

Property Message

#### `Safari`

Property Safari

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
title : string
```

**Example 2:**
```javascript
message : string
```

**Example 3:**
```javascript
new Alert ()
```

**Example 4:**
```javascript
addAction ( title : string )
```

**Example 5:**
```javascript
addDestructiveAction ( title : string )
```

---

## Calendar

### Static Methods

#### `presentPicker`

Static method presentPicker

#### `forRemindersByTitle`

Static method forRemindersByTitle

#### `createForReminders`

Static method createForReminders

#### `defaultForEvents`

Static method defaultForEvents

#### `forEvents`

Static method forEvents

#### `forReminders`

Static method forReminders

#### `forEventsByTitle`

Static method forEventsByTitle

#### `defaultForReminders`

Static method defaultForReminders

#### `findOrCreateForReminders`

Static method findOrCreateForReminders

### Instance Methods

#### `supportsAvailability`

Instance method supportsAvailability

#### `remove`

Instance method remove

#### `save`

Instance method save

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `color`

Property color

#### `DateFormatter`

Property DateFormatter

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `identifier`

Property identifier

#### `Color`

Property Color

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetSpacer`

Property WidgetSpacer

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `title`

Property title

#### `Path`

Property Path

#### `Message`

Property Message

#### `Safari`

Property Safari

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `allowsContentModifications`

Property allowsContentModifications

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `isSubscribed`

Property isSubscribed

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
identifier : string
```

**Example 2:**
```javascript
title : string
```

**Example 3:**
```javascript
isSubscribed : bool
```

**Example 4:**
```javascript
allowsContentModifications : bool
```

**Example 5:**
```javascript
color : Color
```

---

## CalendarEvent

### Static Methods

#### `tomorrow`

Static method tomorrow

#### `between`

Static method between

#### `presentCreate`

Static method presentCreate

#### `lastWeek`

Static method lastWeek

#### `yesterday`

Static method yesterday

#### `thisWeek`

Static method thisWeek

#### `today`

Static method today

#### `nextWeek`

Static method nextWeek

### Instance Methods

#### `addRecurrenceRule`

Instance method addRecurrenceRule

#### `presentEdit`

Instance method presentEdit

#### `new CalendarEvent`

Instance method new CalendarEvent

#### `removeAllRecurrenceRules`

Instance method removeAllRecurrenceRules

#### `remove`

Instance method remove

#### `save`

Instance method save

### Properties

#### `timeZone`

Property timeZone

#### `location`

Property location

#### `config`

Property config

#### `Point`

Property Point

#### `QuickLook`

Property QuickLook

#### `UITableCell`

Property UITableCell

#### `Device`

Property Device

#### `XMLParser`

Property XMLParser

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `WidgetSpacer`

Property WidgetSpacer

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `isAllDay`

Property isAllDay

#### `DatePicker`

Property DatePicker

#### `UUID`

Property UUID

#### `DateFormatter`

Property DateFormatter

#### `endDate`

Property endDate

#### `WidgetStack`

Property WidgetStack

#### `notes`

Property notes

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `startDate`

Property startDate

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `identifier`

Property identifier

#### `Color`

Property Color

#### `Calendar`

Property Calendar

#### `calendar`

Property calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `title`

Property title

#### `Path`

Property Path

#### `Message`

Property Message

#### `Safari`

Property Safari

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `availability`

Property availability

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `attendees`

Property attendees

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
identifier : string
```

**Example 2:**
```javascript
title : string
```

**Example 3:**
```javascript
location : string
```

**Example 4:**
```javascript
notes : string
```

**Example 5:**
```javascript
startDate : Date
```

---

## CallbackURL

### Instance Methods

#### `open`

Instance method open

#### `new CallbackURL`

Instance method new CallbackURL

#### `addParameter`

Instance method addParameter

#### `getURL`

Instance method getURL

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
new CallbackURL ( baseURL : string )
```

**Example 2:**
```javascript
addParameter ( name : string , value : string )
```

**Example 3:**
```javascript
open () : Promise { string : string } >
```

**Example 4:**
```javascript
getURL () : string
```

**Example 5:**
```javascript
new CallbackURL ( baseURL : string )
```

---

## Color

### Static Methods

#### `yellow`

Static method yellow

#### `lightGray`

Static method lightGray

#### `green`

Static method green

#### `magenta`

Static method magenta

#### `orange`

Static method orange

#### `brown`

Static method brown

#### `darkGray`

Static method darkGray

#### `white`

Static method white

#### `red`

Static method red

#### `purple`

Static method purple

#### `cyan`

Static method cyan

#### `gray`

Static method gray

#### `clear`

Static method clear

#### `dynamic`

Static method dynamic

#### `blue`

Static method blue

#### `black`

Static method black

### Instance Methods

#### `new Color`

Instance method new Color

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `red`

Property red

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `green`

Property green

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `hex`

Property hex

#### `alpha`

Property alpha

#### `blue`

Property blue

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Color`

Property Color

#### `Scriptable Docs`

Property Scriptable Docs

#### `Alert`

Property Alert

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
hex : string
```

**Example 2:**
```javascript
red : number
```

**Example 3:**
```javascript
green : number
```

**Example 4:**
```javascript
blue : number
```

**Example 5:**
```javascript
alpha : number
```

---

## Contact

### Static Methods

#### `inGroups`

Static method inGroups

#### `delete`

Static method delete

#### `update`

Static method update

#### `add`

Static method add

#### `persistChanges`

Static method persistChanges

#### `all`

Static method all

### Instance Methods

#### `new Contact`

Instance method new Contact

### Properties

#### `QuickLook`

Property QuickLook

#### `Point`

Property Point

#### `Device`

Property Device

#### `isMiddleNameAvailable`

Property isMiddleNameAvailable

#### `args`

Property args

#### `Request`

Property Request

#### `isBirthdayAvailable`

Property isBirthdayAvailable

#### `givenName`

Property givenName

#### `ShareSheet`

Property ShareSheet

#### `UUID`

Property UUID

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `isURLAddressesAvailable`

Property isURLAddressesAvailable

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `isNicknameAvailable`

Property isNicknameAvailable

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `jobTitle`

Property jobTitle

#### `isOrganizationNameAvailable`

Property isOrganizationNameAvailable

#### `ListWidget`

Property ListWidget

#### `WidgetDate`

Property WidgetDate

#### `Safari`

Property Safari

#### `Path`

Property Path

#### `middleName`

Property middleName

#### `isEmailAddressesAvailable`

Property isEmailAddressesAvailable

#### `Dictation`

Property Dictation

#### `Pasteboard`

Property Pasteboard

#### `nickname`

Property nickname

#### `emailAddresses`

Property emailAddresses

#### `RecurrenceRule`

Property RecurrenceRule

#### `UITableCell`

Property UITableCell

#### `XMLParser`

Property XMLParser

#### `DrawContext`

Property DrawContext

#### `phoneNumbers`

Property phoneNumbers

#### `postalAddresses`

Property postalAddresses

#### `departmentName`

Property departmentName

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `isDepartmentNameAvailable`

Property isDepartmentNameAvailable

#### `image`

Property image

#### `socialProfiles`

Property socialProfiles

#### `Data`

Property Data

#### `Location`

Property Location

#### `WidgetImage`

Property WidgetImage

#### `WidgetSpacer`

Property WidgetSpacer

#### `UITableRow`

Property UITableRow

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `isImageAvailable`

Property isImageAvailable

#### `config`

Property config

#### `familyName`

Property familyName

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `isDatesAvailable`

Property isDatesAvailable

#### `isFamilyNameAvailable`

Property isFamilyNameAvailable

#### `DatePicker`

Property DatePicker

#### `isNamePrefixAvailable`

Property isNamePrefixAvailable

#### `isSocialProfilesAvailable`

Property isSocialProfilesAvailable

#### `isNoteAvailable`

Property isNoteAvailable

#### `Color`

Property Color

#### `WidgetStack`

Property WidgetStack

#### `identifier`

Property identifier

#### `isPhoneNumbersAvailable`

Property isPhoneNumbersAvailable

#### `SFSymbol`

Property SFSymbol

#### `WebView`

Property WebView

#### `organizationName`

Property organizationName

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `urlAddresses`

Property urlAddresses

#### `Reminder`

Property Reminder

#### `DocumentPicker`

Property DocumentPicker

#### `isPostalAddressesAvailable`

Property isPostalAddressesAvailable

#### `Speech`

Property Speech

#### `ContactsContainer`

Property ContactsContainer

#### `dates`

Property dates

#### `TextField`

Property TextField

#### `Size`

Property Size

#### `note`

Property note

#### `Notification`

Property Notification

#### `isGiveNameAvailable`

Property isGiveNameAvailable

#### `ContactsGroup`

Property ContactsGroup

#### `isJobTitleAvailable`

Property isJobTitleAvailable

#### `DateFormatter`

Property DateFormatter

#### `URLScheme`

Property URLScheme

#### `WidgetText`

Property WidgetText

#### `console`

Property console

#### `Message`

Property Message

#### `birthday`

Property birthday

#### `namePrefix`

Property namePrefix

#### `Contact`

Property Contact

#### `importModule`

Property importModule

### Code Examples

**Example 1:**
```javascript
ContactsContainer
```

**Example 2:**
```javascript
identifier : string
```

**Example 3:**
```javascript
namePrefix : string
```

**Example 4:**
```javascript
givenName : string
```

**Example 5:**
```javascript
middleName : string
```

---

## ContactsContainer

### Static Methods

#### `withIdentifier`

Static method withIdentifier

#### `default`

Static method default

#### `all`

Static method all

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `name`

Property name

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `identifier`

Property identifier

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetSpacer`

Property WidgetSpacer

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
identifier : string
```

**Example 2:**
```javascript
name : string
```

**Example 3:**
```javascript
static default () : Promise ContactsContainer >
```

**Example 4:**
```javascript
static all () : Promise [ ContactsContainer ] >
```

**Example 5:**
```javascript
static withIdentifier ( identifier : string ) : Promise ContactsContainer >
```

---

## ContactsGroup

### Static Methods

#### `delete`

Static method delete

#### `add`

Static method add

#### `update`

Static method update

#### `all`

Static method all

### Instance Methods

#### `removeMember`

Instance method removeMember

#### `new ContactsGroup`

Instance method new ContactsGroup

#### `addMember`

Instance method addMember

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `name`

Property name

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `identifier`

Property identifier

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetSpacer`

Property WidgetSpacer

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
identifier : string
```

**Example 2:**
```javascript
name : string
```

**Example 3:**
```javascript
new ContactsGroup ()
```

**Example 4:**
```javascript
ContactsGroup.add()
```

**Example 5:**
```javascript
Contact.persistChanges()
```

---

## Data

### Static Methods

#### `fromBase64String`

Static method fromBase64String

#### `fromPNG`

Static method fromPNG

#### `fromString`

Static method fromString

#### `fromFile`

Static method fromFile

#### `fromBytes`

Static method fromBytes

#### `fromJPEG`

Static method fromJPEG

### Instance Methods

#### `getBytes`

Instance method getBytes

#### `toRawString`

Instance method toRawString

#### `toBase64String`

Instance method toBase64String

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static fromString ( string : string ) : Data
```

**Example 2:**
```javascript
static fromFile ( filePath : string ) : Data
```

**Example 3:**
```javascript
static fromBase64String ( base64String : string ) : Data
```

**Example 4:**
```javascript
static fromJPEG ( image : Image ) : Data
```

**Example 5:**
```javascript
static fromPNG ( image : Image ) : Data
```

---

## DateFormatter

### Instance Methods

#### `useShortTimeStyle`

Instance method useShortTimeStyle

#### `useLongDateStyle`

Instance method useLongDateStyle

#### `useFullTimeStyle`

Instance method useFullTimeStyle

#### `string`

Instance method string

#### `useShortDateStyle`

Instance method useShortDateStyle

#### `date`

Instance method date

#### `useNoDateStyle`

Instance method useNoDateStyle

#### `useMediumTimeStyle`

Instance method useMediumTimeStyle

#### `useMediumDateStyle`

Instance method useMediumDateStyle

#### `new DateFormatter`

Instance method new DateFormatter

#### `useFullDateStyle`

Instance method useFullDateStyle

#### `useNoTimeStyle`

Instance method useNoTimeStyle

#### `useLongTimeStyle`

Instance method useLongTimeStyle

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `dateFormat`

Property dateFormat

#### `DatePicker`

Property DatePicker

#### `UUID`

Property UUID

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `locale`

Property locale

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetDate`

Property WidgetDate

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
useMediumDateStyle()
```

**Example 2:**
```javascript
useMediumTimeStyle()
```

**Example 3:**
```javascript
dateFormat : string
```

**Example 4:**
```javascript
locale : string
```

**Example 5:**
```javascript
new DateFormatter ()
```

---

## DatePicker

### Instance Methods

#### `pickDateAndTime`

Instance method pickDateAndTime

#### `pickDate`

Instance method pickDate

#### `pickTime`

Instance method pickTime

#### `new DatePicker`

Instance method new DatePicker

#### `pickCountdownDuration`

Instance method pickCountdownDuration

### Properties

#### `countdownDuration`

Property countdownDuration

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetText`

Property WidgetText

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `minuteInterval`

Property minuteInterval

#### `UITable`

Property UITable

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `minimumDate`

Property minimumDate

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `initialDate`

Property initialDate

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `maximumDate`

Property maximumDate

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
pickDateAndTime()
```

**Example 2:**
```javascript
pickCountDownTimer()
```

**Example 3:**
```javascript
pickDateAndTime()
```

**Example 4:**
```javascript
pickCountDownTimer()
```

**Example 5:**
```javascript
minimumDate : Date
```

---

## Device

### Static Methods

#### `systemName`

Static method systemName

#### `isInLandscapeRight`

Static method isInLandscapeRight

#### `volume`

Static method volume

#### `name`

Static method name

#### `isDischarging`

Static method isDischarging

#### `isFullyCharged`

Static method isFullyCharged

#### `isCharging`

Static method isCharging

#### `isPhone`

Static method isPhone

#### `isFaceDown`

Static method isFaceDown

#### `model`

Static method model

#### `screenBrightness`

Static method screenBrightness

#### `systemVersion`

Static method systemVersion

#### `setScreenBrightness`

Static method setScreenBrightness

#### `isFaceUp`

Static method isFaceUp

#### `batteryLevel`

Static method batteryLevel

#### `isInLandscapeLeft`

Static method isInLandscapeLeft

#### `locale`

Static method locale

#### `screenResolution`

Static method screenResolution

#### `language`

Static method language

#### `preferredLanguages`

Static method preferredLanguages

#### `isUsingDarkAppearance`

Static method isUsingDarkAppearance

#### `screenScale`

Static method screenScale

#### `screenSize`

Static method screenSize

#### `isInPortrait`

Static method isInPortrait

#### `isInPortraitUpsideDown`

Static method isInPortraitUpsideDown

#### `isPad`

Static method isPad

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static name () : string
```

**Example 2:**
```javascript
static systemName () : string
```

**Example 3:**
```javascript
static systemVersion () : string
```

**Example 4:**
```javascript
static model () : string
```

**Example 5:**
```javascript
static isPhone () : bool
```

---

## Dictation

### Static Methods

#### `start`

Static method start

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Dictation`

Property Dictation

#### `Contact`

Property Contact

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static start ( locale : string ) : Promise string >
```

**Example 2:**
```javascript
static start ( locale : string ) : Promise string >
```

---

## DocumentPicker

### Static Methods

#### `export`

Static method export

#### `exportImage`

Static method exportImage

#### `exportData`

Static method exportData

#### `open`

Static method open

#### `openFile`

Static method openFile

#### `openFolder`

Static method openFolder

#### `exportString`

Static method exportString

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `DocumentPicker`

Property DocumentPicker

#### `Dictation`

Property Dictation

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static open ( types : [ string ]) : Promise [ string ] >
```

**Example 2:**
```javascript
static openFile () : Promise string >
```

**Example 3:**
```javascript
static openFolder () : Promise string >
```

**Example 4:**
```javascript
static export ( path : string ) : Promise [ string ] >
```

**Example 5:**
```javascript
static exportString ( content : string , name : string ) : Promise [ string ] >
```

---

## DrawContext

### Instance Methods

#### `drawImageAtPoint`

Instance method drawImageAtPoint

#### `drawText`

Instance method drawText

#### `new DrawContext`

Instance method new DrawContext

#### `drawTextInRect`

Instance method drawTextInRect

#### `strokeEllipse`

Instance method strokeEllipse

#### `fill`

Instance method fill

#### `drawImageInRect`

Instance method drawImageInRect

#### `setFont`

Instance method setFont

#### `setTextAlignedLeft`

Instance method setTextAlignedLeft

#### `fillPath`

Instance method fillPath

#### `setTextAlignedCenter`

Instance method setTextAlignedCenter

#### `strokePath`

Instance method strokePath

#### `setTextColor`

Instance method setTextColor

#### `strokeRect`

Instance method strokeRect

#### `setFontSize`

Instance method setFontSize

#### `fillRect`

Instance method fillRect

#### `getImage`

Instance method getImage

#### `fillEllipse`

Instance method fillEllipse

#### `stroke`

Instance method stroke

#### `setFillColor`

Instance method setFillColor

#### `addPath`

Instance method addPath

#### `setTextAlignedRight`

Instance method setTextAlignedRight

#### `setLineWidth`

Instance method setLineWidth

#### `setStrokeColor`

Instance method setStrokeColor

### Properties

#### `respectScreenScale`

Property respectScreenScale

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `opaque`

Property opaque

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `size`

Property size

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetSpacer`

Property WidgetSpacer

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
size : Size
```

**Example 2:**
```javascript
respectScreenScale : bool
```

**Example 3:**
```javascript
opaque : bool
```

**Example 4:**
```javascript
new DrawContext ()
```

**Example 5:**
```javascript
getImage () : Image
```

---

## FileManager

### Static Methods

#### `local`

Static method local

#### `iCloud`

Static method iCloud

### Instance Methods

#### `read`

Instance method read

#### `downloadFileFromiCloud`

Instance method downloadFileFromiCloud

#### `readImage`

Instance method readImage

#### `documentsDirectory`

Instance method documentsDirectory

#### `move`

Instance method move

#### `allExtendedAttributes`

Instance method allExtendedAttributes

#### `addTag`

Instance method addTag

#### `writeExtendedAttribute`

Instance method writeExtendedAttribute

#### `allFileBookmarks`

Instance method allFileBookmarks

#### `fileExists`

Instance method fileExists

#### `writeImage`

Instance method writeImage

#### `joinPath`

Instance method joinPath

#### `write`

Instance method write

#### `fileName`

Instance method fileName

#### `isFileDownloaded`

Instance method isFileDownloaded

#### `copy`

Instance method copy

#### `remove`

Instance method remove

#### `temporaryDirectory`

Instance method temporaryDirectory

#### `allTags`

Instance method allTags

#### `readExtendedAttribute`

Instance method readExtendedAttribute

#### `removeExtendedAttribute`

Instance method removeExtendedAttribute

#### `fileSize`

Instance method fileSize

#### `creationDate`

Instance method creationDate

#### `cacheDirectory`

Instance method cacheDirectory

#### `isDirectory`

Instance method isDirectory

#### `modificationDate`

Instance method modificationDate

#### `libraryDirectory`

Instance method libraryDirectory

#### `bookmarkExists`

Instance method bookmarkExists

#### `createDirectory`

Instance method createDirectory

#### `getUTI`

Instance method getUTI

#### `fileExtension`

Instance method fileExtension

#### `listContents`

Instance method listContents

#### `bookmarkedPath`

Instance method bookmarkedPath

#### `isFileStoredIniCloud`

Instance method isFileStoredIniCloud

#### `removeTag`

Instance method removeTag

#### `readString`

Instance method readString

#### `writeString`

Instance method writeString

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static local () : FileManager
```

**Example 2:**
```javascript
static iCloud () : FileManager
```

**Example 3:**
```javascript
read ( filePath : string ) : Data
```

**Example 4:**
```javascript
readString(filePath)
```

**Example 5:**
```javascript
readImage(filePath)
```

---

## Font

### Static Methods

#### `lightMonospacedSystemFont`

Static method lightMonospacedSystemFont

#### `thinSystemFont`

Static method thinSystemFont

#### `boldRoundedSystemFont`

Static method boldRoundedSystemFont

#### `headline`

Static method headline

#### `blackSystemFont`

Static method blackSystemFont

#### `title3`

Static method title3

#### `title1`

Static method title1

#### `ultraLightMonospacedSystemFont`

Static method ultraLightMonospacedSystemFont

#### `ultraLightSystemFont`

Static method ultraLightSystemFont

#### `caption1`

Static method caption1

#### `callout`

Static method callout

#### `mediumSystemFont`

Static method mediumSystemFont

#### `semiboldSystemFont`

Static method semiboldSystemFont

#### `semiboldMonospacedSystemFont`

Static method semiboldMonospacedSystemFont

#### `boldMonospacedSystemFont`

Static method boldMonospacedSystemFont

#### `heavyMonospacedSystemFont`

Static method heavyMonospacedSystemFont

#### `heavyRoundedSystemFont`

Static method heavyRoundedSystemFont

#### `blackRoundedSystemFont`

Static method blackRoundedSystemFont

#### `largeTitle`

Static method largeTitle

#### `italicSystemFont`

Static method italicSystemFont

#### `lightSystemFont`

Static method lightSystemFont

#### `regularMonospacedSystemFont`

Static method regularMonospacedSystemFont

#### `body`

Static method body

#### `regularSystemFont`

Static method regularSystemFont

#### `mediumRoundedSystemFont`

Static method mediumRoundedSystemFont

#### `thinRoundedSystemFont`

Static method thinRoundedSystemFont

#### `heavySystemFont`

Static method heavySystemFont

#### `semiboldRoundedSystemFont`

Static method semiboldRoundedSystemFont

#### `lightRoundedSystemFont`

Static method lightRoundedSystemFont

#### `ultraLightRoundedSystemFont`

Static method ultraLightRoundedSystemFont

#### `subheadline`

Static method subheadline

#### `footnote`

Static method footnote

#### `mediumMonospacedSystemFont`

Static method mediumMonospacedSystemFont

#### `systemFont`

Static method systemFont

#### `blackMonospacedSystemFont`

Static method blackMonospacedSystemFont

#### `regularRoundedSystemFont`

Static method regularRoundedSystemFont

#### `title2`

Static method title2

#### `boldSystemFont`

Static method boldSystemFont

#### `thinMonospacedSystemFont`

Static method thinMonospacedSystemFont

#### `caption2`

Static method caption2

### Instance Methods

#### `new Font`

Instance method new Font

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
new Font ( name : string , size : number )
```

**Example 2:**
```javascript
static largeTitle () : Font
```

**Example 3:**
```javascript
static title1 () : Font
```

**Example 4:**
```javascript
static title2 () : Font
```

**Example 5:**
```javascript
static title3 () : Font
```

---

## Image

### Static Methods

#### `fromFile`

Static method fromFile

#### `fromData`

Static method fromData

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `size`

Property size

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetSpacer`

Property WidgetSpacer

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
size : Size
```

**Example 2:**
```javascript
static fromFile ( filePath : string ) : Image
```

**Example 3:**
```javascript
static fromData ( data : Data ) : Image
```

**Example 4:**
```javascript
size : Size
```

**Example 5:**
```javascript
static fromFile ( filePath : string ) : Image
```

---

## Keychain

### Static Methods

#### `get`

Static method get

#### `contains`

Static method contains

#### `remove`

Static method remove

#### `set`

Static method set

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static contains ( key : string ) : bool
```

**Example 2:**
```javascript
static set ( key : string , value : string )
```

**Example 3:**
```javascript
static get ( key : string ) : string
```

**Example 4:**
```javascript
static remove ( key : string )
```

**Example 5:**
```javascript
static contains ( key : string ) : bool
```

---

## LinearGradient

### Instance Methods

#### `new LinearGradient`

Instance method new LinearGradient

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `colors`

Property colors

#### `startPoint`

Property startPoint

#### `DrawContext`

Property DrawContext

#### `Request`

Property Request

#### `Size`

Property Size

#### `TextField`

Property TextField

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetStack`

Property WidgetStack

#### `locations`

Property locations

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `endPoint`

Property endPoint

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetSpacer`

Property WidgetSpacer

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
colors : [ Color ]
```

**Example 2:**
```javascript
locations : [ number ]
```

**Example 3:**
```javascript
startPoint : Point
```

**Example 4:**
```javascript
endPoint : Point
```

**Example 5:**
```javascript
new LinearGradient ()
```

---

## ListWidget

### Instance Methods

#### `presentAccessoryRectangular`

Instance method presentAccessoryRectangular

#### `presentExtraLarge`

Instance method presentExtraLarge

#### `addText`

Instance method addText

#### `useDefaultPadding`

Instance method useDefaultPadding

#### `addStack`

Instance method addStack

#### `presentLarge`

Instance method presentLarge

#### `addDate`

Instance method addDate

#### `presentAccessoryCircular`

Instance method presentAccessoryCircular

#### `presentAccessoryInline`

Instance method presentAccessoryInline

#### `presentSmall`

Instance method presentSmall

#### `presentMedium`

Instance method presentMedium

#### `addSpacer`

Instance method addSpacer

#### `addImage`

Instance method addImage

#### `setPadding`

Instance method setPadding

#### `new ListWidget`

Instance method new ListWidget

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `backgroundColor`

Property backgroundColor

#### `Timer`

Property Timer

#### `backgroundImage`

Property backgroundImage

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetText`

Property WidgetText

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `addAccessoryWidgetBackground`

Property addAccessoryWidgetBackground

#### `Message`

Property Message

#### `Safari`

Property Safari

#### `spacing`

Property spacing

#### `WebView`

Property WebView

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `refreshAfterDate`

Property refreshAfterDate

#### `backgroundGradient`

Property backgroundGradient

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `url`

Property url

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
backgroundColor : Color
```

**Example 2:**
```javascript
backgroundImage : Image
```

**Example 3:**
```javascript
backgroundGradient : LinearGradient
```

**Example 4:**
```javascript
addAccessoryWidgetBackground : bool
```

**Example 5:**
```javascript
addSpacer()
```

---

## Location

### Static Methods

#### `setAccuracyToBest`

Static method setAccuracyToBest

#### `setAccuracyToHundredMeters`

Static method setAccuracyToHundredMeters

#### `setAccuracyToKilometer`

Static method setAccuracyToKilometer

#### `current`

Static method current

#### `setAccuracyToThreeKilometers`

Static method setAccuracyToThreeKilometers

#### `setAccuracyToTenMeters`

Static method setAccuracyToTenMeters

#### `reverseGeocode`

Static method reverseGeocode

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static current () : Promise { string : number } >
```

**Example 2:**
```javascript
static setAccuracyToBest ()
```

**Example 3:**
```javascript
static setAccuracyToTenMeters ()
```

**Example 4:**
```javascript
static setAccuracyToHundredMeters ()
```

**Example 5:**
```javascript
static setAccuracyToKilometer ()
```

---

## Mail

### Instance Methods

#### `addDataAttachment`

Instance method addDataAttachment

#### `new Mail`

Instance method new Mail

#### `send`

Instance method send

#### `addImageAttachment`

Instance method addImageAttachment

#### `addFileAttachment`

Instance method addFileAttachment

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `module`

Property module

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `WidgetImage`

Property WidgetImage

#### `DateFormatter`

Property DateFormatter

#### `isBodyHTML`

Property isBodyHTML

#### `WidgetStack`

Property WidgetStack

#### `bccRecipients`

Property bccRecipients

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `toRecipients`

Property toRecipients

#### `subject`

Property subject

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `body`

Property body

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetSpacer`

Property WidgetSpacer

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `ccRecipients`

Property ccRecipients

#### `Reminder`

Property Reminder

#### `preferredSendingEmailAddress`

Property preferredSendingEmailAddress

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
toRecipients : [ string ]
```

**Example 2:**
```javascript
ccRecipients : [ string ]
```

**Example 3:**
```javascript
bccRecipients : [ string ]
```

**Example 4:**
```javascript
subject : string
```

**Example 5:**
```javascript
body : string
```

---

## Message

### Instance Methods

#### `addDataAttachment`

Instance method addDataAttachment

#### `new Message`

Instance method new Message

#### `send`

Instance method send

#### `addImageAttachment`

Instance method addImageAttachment

#### `addFileAttachment`

Instance method addFileAttachment

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `recipients`

Property recipients

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `body`

Property body

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetSpacer`

Property WidgetSpacer

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
recipients : [ string ]
```

**Example 2:**
```javascript
body : string
```

**Example 3:**
```javascript
new Message ()
```

**Example 4:**
```javascript
send () : Promise
```

**Example 5:**
```javascript
addImageAttachment ( image : Image )
```

---

## Notification

### Static Methods

#### `removeAllDelivered`

Static method removeAllDelivered

#### `allDelivered`

Static method allDelivered

#### `removePending`

Static method removePending

#### `current`

Static method current

#### `allPending`

Static method allPending

#### `resetCurrent`

Static method resetCurrent

#### `removeAllPending`

Static method removeAllPending

#### `removeDelivered`

Static method removeDelivered

### Instance Methods

#### `new Notification`

Instance method new Notification

#### `setWeeklyTrigger`

Instance method setWeeklyTrigger

#### `schedule`

Instance method schedule

#### `setTriggerDate`

Instance method setTriggerDate

#### `setDailyTrigger`

Instance method setDailyTrigger

#### `remove`

Instance method remove

#### `addAction`

Instance method addAction

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `openURL`

Property openURL

#### `actions`

Property actions

#### `CalendarEvent`

Property CalendarEvent

#### `WidgetSpacer`

Property WidgetSpacer

#### `subtitle`

Property subtitle

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `WidgetImage`

Property WidgetImage

#### `badge`

Property badge

#### `DateFormatter`

Property DateFormatter

#### `preferredContentHeight`

Property preferredContentHeight

#### `WidgetDate`

Property WidgetDate

#### `WidgetStack`

Property WidgetStack

#### `WidgetText`

Property WidgetText

#### `Data`

Property Data

#### `threadIdentifier`

Property threadIdentifier

#### `Location`

Property Location

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `scriptName`

Property scriptName

#### `URLScheme`

Property URLScheme

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `identifier`

Property identifier

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `body`

Property body

#### `UITable`

Property UITable

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `sound`

Property sound

#### `console`

Property console

#### `title`

Property title

#### `Path`

Property Path

#### `Message`

Property Message

#### `Safari`

Property Safari

#### `nextTriggerDate`

Property nextTriggerDate

#### `WebView`

Property WebView

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

#### `deliveryDate`

Property deliveryDate

#### `userInfo`

Property userInfo

### Code Examples

**Example 1:**
```javascript
identifier : string
```

**Example 2:**
```javascript
title : string
```

**Example 3:**
```javascript
subtitle : string
```

**Example 4:**
```javascript
body : string
```

**Example 5:**
```javascript
preferredContentHeight : number
```

---

## Pasteboard

### Static Methods

#### `paste`

Static method paste

#### `copyString`

Static method copyString

#### `pasteImage`

Static method pasteImage

#### `copy`

Static method copy

#### `pasteString`

Static method pasteString

#### `copyImage`

Static method copyImage

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `Pasteboard`

Property Pasteboard

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static copy ( string : string )
```

**Example 2:**
```javascript
static paste () : string
```

**Example 3:**
```javascript
static copyString ( string : string )
```

**Example 4:**
```javascript
static pasteString () : string
```

**Example 5:**
```javascript
static copyImage ( image : Image )
```

---

## Path

### Instance Methods

#### `addLine`

Instance method addLine

#### `addCurve`

Instance method addCurve

#### `addRoundedRect`

Instance method addRoundedRect

#### `move`

Instance method move

#### `addQuadCurve`

Instance method addQuadCurve

#### `addEllipse`

Instance method addEllipse

#### `addRect`

Instance method addRect

#### `closeSubpath`

Instance method closeSubpath

#### `addRects`

Instance method addRects

#### `new Path`

Instance method new Path

#### `addLines`

Instance method addLines

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
new Path ()
```

**Example 2:**
```javascript
move ( point : Point )
```

**Example 3:**
```javascript
addLine ( point : Point )
```

**Example 4:**
```javascript
addRect ( rect : Rect )
```

**Example 5:**
```javascript
addEllipse ( rect : Rect )
```

---

## Photos

### Static Methods

#### `fromLibrary`

Static method fromLibrary

#### `latestScreenshots`

Static method latestScreenshots

#### `removeLatestScreenshots`

Static method removeLatestScreenshots

#### `latestScreenshot`

Static method latestScreenshot

#### `fromCamera`

Static method fromCamera

#### `latestPhotos`

Static method latestPhotos

#### `removeLatestPhoto`

Static method removeLatestPhoto

#### `latestPhoto`

Static method latestPhoto

#### `removeLatestScreenshot`

Static method removeLatestScreenshot

#### `removeLatestPhotos`

Static method removeLatestPhotos

#### `save`

Static method save

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static fromLibrary () : Promise Image >
```

**Example 2:**
```javascript
static fromCamera () : Promise Image >
```

**Example 3:**
```javascript
static latestPhoto () : Promise Image >
```

**Example 4:**
```javascript
static latestPhotos ( count : number ) : Promise [ Image ] >
```

**Example 5:**
```javascript
static latestScreenshot () : Promise Image >
```

---

## Point

### Instance Methods

#### `new Point`

Instance method new Point

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `Point`

Property Point

#### `config`

Property config

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `y`

Property y

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

#### `x`

Property x

### Code Examples

**Example 1:**
```javascript
new Point ( x : number , y : number )
```

**Example 2:**
```javascript
new Point ( x : number , y : number )
```

---

## QuickLook

### Static Methods

#### `present`

Static method present

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static present ( item : any , fullscreen : bool ) : Promise
```

**Example 2:**
```javascript
static present ( item : any , fullscreen : bool ) : Promise
```

---

## Rect

### Instance Methods

#### `new Rect`

Instance method new Rect

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `WidgetSpacer`

Property WidgetSpacer

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `width`

Property width

#### `ContactsGroup`

Property ContactsGroup

#### `height`

Property height

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `maxX`

Property maxX

#### `WidgetStack`

Property WidgetStack

#### `maxY`

Property maxY

#### `minY`

Property minY

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `size`

Property size

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `origin`

Property origin

#### `UITable`

Property UITable

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `y`

Property y

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `minX`

Property minX

#### `ContactsContainer`

Property ContactsContainer

#### `x`

Property x

### Code Examples

**Example 1:**
```javascript
minX : number
```

**Example 2:**
```javascript
minY : number
```

**Example 3:**
```javascript
maxX : number
```

**Example 4:**
```javascript
maxY : number
```

**Example 5:**
```javascript
width : number
```

---

## RecurrenceRule

### Static Methods

#### `dailyEndDate`

Static method dailyEndDate

#### `complexYearlyOccurrenceCount`

Static method complexYearlyOccurrenceCount

#### `weeklyOccurrenceCount`

Static method weeklyOccurrenceCount

#### `dailyOccurrenceCount`

Static method dailyOccurrenceCount

#### `complexMonthlyOccurrenceCount`

Static method complexMonthlyOccurrenceCount

#### `complexWeeklyOccurrenceCount`

Static method complexWeeklyOccurrenceCount

#### `monthlyOccurrenceCount`

Static method monthlyOccurrenceCount

#### `weekly`

Static method weekly

#### `daily`

Static method daily

#### `weeklyEndDate`

Static method weeklyEndDate

#### `yearlyEndDate`

Static method yearlyEndDate

#### `yearlyOccurrenceCount`

Static method yearlyOccurrenceCount

#### `complexMonthly`

Static method complexMonthly

#### `monthly`

Static method monthly

#### `monthlyEndDate`

Static method monthlyEndDate

#### `complexMonthlyEndDate`

Static method complexMonthlyEndDate

#### `complexWeeklyEndDate`

Static method complexWeeklyEndDate

#### `complexYearlyEndDate`

Static method complexYearlyEndDate

#### `complexYearly`

Static method complexYearly

#### `complexWeekly`

Static method complexWeekly

#### `yearly`

Static method yearly

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static daily ( interval : number ) : RecurrenceRule
```

**Example 2:**
```javascript
static dailyEndDate ( interval : number , endDate : Date ) : RecurrenceRule
```

**Example 3:**
```javascript
static dailyOccurrenceCount ( interval : number , occurrenceCount : number ) : RecurrenceRule
```

**Example 4:**
```javascript
static weekly ( interval : number ) : RecurrenceRule
```

**Example 5:**
```javascript
static weeklyEndDate ( interval : number , endDate : Date ) : RecurrenceRule
```

---

## RelativeDateTimeFormatter

### Instance Methods

#### `new RelativeDateTimeFormatter`

Instance method new RelativeDateTimeFormatter

#### `useNumericDateTimeStyle`

Instance method useNumericDateTimeStyle

#### `string`

Instance method string

#### `useNamedDateTimeStyle`

Instance method useNamedDateTimeStyle

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `locale`

Property locale

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetDate`

Property WidgetDate

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
locale : string
```

**Example 2:**
```javascript
new RelativeDateTimeFormatter ()
```

**Example 3:**
```javascript
string ( date : Date , referenceDate : Date ) : string
```

**Example 4:**
```javascript
useNamedDateTimeStyle ()
```

**Example 5:**
```javascript
useNumericDateTimeStyle ()
```

---

## Reminder

### Static Methods

#### `completedDueYesterday`

Static method completedDueYesterday

#### `incompleteDueToday`

Static method incompleteDueToday

#### `scheduled`

Static method scheduled

#### `completedDueBetween`

Static method completedDueBetween

#### `completedLastWeek`

Static method completedLastWeek

#### `allIncomplete`

Static method allIncomplete

#### `completedDueNextWeek`

Static method completedDueNextWeek

#### `completedDueLastWeek`

Static method completedDueLastWeek

#### `incompleteDueBetween`

Static method incompleteDueBetween

#### `incompleteDueNextWeek`

Static method incompleteDueNextWeek

#### `allCompleted`

Static method allCompleted

#### `allDueYesterday`

Static method allDueYesterday

#### `incompleteDueLastWeek`

Static method incompleteDueLastWeek

#### `completedDueToday`

Static method completedDueToday

#### `incompleteDueTomorrow`

Static method incompleteDueTomorrow

#### `incompleteDueThisWeek`

Static method incompleteDueThisWeek

#### `completedDueTomorrow`

Static method completedDueTomorrow

#### `allDueTomorrow`

Static method allDueTomorrow

#### `completedToday`

Static method completedToday

#### `allDueNextWeek`

Static method allDueNextWeek

#### `completedBetween`

Static method completedBetween

#### `allDueToday`

Static method allDueToday

#### `completedDueThisWeek`

Static method completedDueThisWeek

#### `completedThisWeek`

Static method completedThisWeek

#### `allDueLastWeek`

Static method allDueLastWeek

#### `allDueBetween`

Static method allDueBetween

#### `allDueThisWeek`

Static method allDueThisWeek

#### `incompleteDueYesterday`

Static method incompleteDueYesterday

#### `all`

Static method all

### Instance Methods

#### `new Reminder`

Instance method new Reminder

#### `addRecurrenceRule`

Instance method addRecurrenceRule

#### `removeAllRecurrenceRules`

Instance method removeAllRecurrenceRules

#### `save`

Instance method save

#### `remove`

Instance method remove

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `UITable`

Property UITable

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `WidgetSpacer`

Property WidgetSpacer

#### `CalendarEvent`

Property CalendarEvent

#### `isCompleted`

Property isCompleted

#### `dueDate`

Property dueDate

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetDate`

Property WidgetDate

#### `WidgetStack`

Property WidgetStack

#### `WidgetText`

Property WidgetText

#### `notes`

Property notes

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `identifier`

Property identifier

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `dueDateIncludesTime`

Property dueDateIncludesTime

#### `creationDate`

Property creationDate

#### `ListWidget`

Property ListWidget

#### `calendar`

Property calendar

#### `completionDate`

Property completionDate

#### `SFSymbol`

Property SFSymbol

#### `console`

Property console

#### `Path`

Property Path

#### `title`

Property title

#### `Message`

Property Message

#### `Safari`

Property Safari

#### `UITableRow`

Property UITableRow

#### `WebView`

Property WebView

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `isOverdue`

Property isOverdue

#### `Font`

Property Font

#### `Reminder`

Property Reminder

#### `CallbackURL`

Property CallbackURL

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

#### `priority`

Property priority

### Code Examples

**Example 1:**
```javascript
identifier : string
```

**Example 2:**
```javascript
title : string
```

**Example 3:**
```javascript
notes : string
```

**Example 4:**
```javascript
isCompleted : bool
```

**Example 5:**
```javascript
isOverdue : bool
```

---

## Request

### Instance Methods

#### `load`

Instance method load

#### `addFileDataToMultipart`

Instance method addFileDataToMultipart

#### `loadJSON`

Instance method loadJSON

#### `addParameterToMultipart`

Instance method addParameterToMultipart

#### `addFileToMultipart`

Instance method addFileToMultipart

#### `new Request`

Instance method new Request

#### `loadImage`

Instance method loadImage

#### `loadString`

Instance method loadString

#### `addImageToMultipart`

Instance method addImageToMultipart

### Properties

#### `timeoutInterval`

Property timeoutInterval

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `onRedirect`

Property onRedirect

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `WidgetSpacer`

Property WidgetSpacer

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `allowInsecureRequest`

Property allowInsecureRequest

#### `DateFormatter`

Property DateFormatter

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `body`

Property body

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `response`

Property response

#### `UITable`

Property UITable

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `headers`

Property headers

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `url`

Property url

#### `ContactsContainer`

Property ContactsContainer

#### `method`

Property method

### Code Examples

**Example 1:**
```javascript
url : string
```

**Example 2:**
```javascript
method : string
```

**Example 3:**
```javascript
headers : { string : string }
```

**Example 4:**
```javascript
addParameterToMultipart
```

**Example 5:**
```javascript
addFileToMultipart
```

---

## SFSymbol

### Static Methods

#### `named`

Static method named

### Instance Methods

#### `applySemiboldWeight`

Instance method applySemiboldWeight

#### `applyThinWeight`

Instance method applyThinWeight

#### `applyFont`

Instance method applyFont

#### `applyHeavyWeight`

Instance method applyHeavyWeight

#### `applyBoldWeight`

Instance method applyBoldWeight

#### `applyLightWeight`

Instance method applyLightWeight

#### `applyBlackWeight`

Instance method applyBlackWeight

#### `applyMediumWeight`

Instance method applyMediumWeight

#### `applyRegularWeight`

Instance method applyRegularWeight

#### `applyUltraLightWeight`

Instance method applyUltraLightWeight

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `image`

Property image

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
image : Image
```

**Example 2:**
```javascript
static named ( symbolName : string ) : SFSymbol
```

**Example 3:**
```javascript
applyFont ( font : Font )
```

**Example 4:**
```javascript
applyUltraLightWeight ()
```

**Example 5:**
```javascript
applyThinWeight ()
```

---

## Safari

### Static Methods

#### `open`

Static method open

#### `openInApp`

Static method openInApp

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `Safari`

Property Safari

#### `console`

Property console

#### `Path`

Property Path

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static openInApp ( url : string , fullscreen : bool ) : Promise
```

**Example 2:**
```javascript
static open ( url : string )
```

**Example 3:**
```javascript
static openInApp ( url : string , fullscreen : bool ) : Promise
```

**Example 4:**
```javascript
static open ( url : string )
```

---

## Script

### Static Methods

#### `name`

Static method name

#### `setShortcutOutput`

Static method setShortcutOutput

#### `complete`

Static method complete

#### `setWidget`

Static method setWidget

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Script`

Property Script

#### `Rect`

Property Rect

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static name () : string
```

**Example 2:**
```javascript
static complete ()
```

**Example 3:**
```javascript
static setShortcutOutput ( value : any )
```

**Example 4:**
```javascript
static setWidget ( widget : any )
```

**Example 5:**
```javascript
static name () : string
```

---

## ShareSheet

### Static Methods

#### `present`

Static method present

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `ShareSheet`

Property ShareSheet

#### `Notification`

Property Notification

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static present ( activityItems : [ any ]) : Promise { string : any } >
```

**Example 2:**
```javascript
static present ( activityItems : [ any ]) : Promise { string : any } >
```

---

## Size

### Instance Methods

#### `new Size`

Instance method new Size

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `width`

Property width

#### `ContactsGroup`

Property ContactsGroup

#### `height`

Property height

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
width : number
```

**Example 2:**
```javascript
height : number
```

**Example 3:**
```javascript
new Size ( width : number , height : number )
```

**Example 4:**
```javascript
width : number
```

**Example 5:**
```javascript
height : number
```

---

## Speech

### Static Methods

#### `speak`

Static method speak

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static speak ( text : string )
```

**Example 2:**
```javascript
static speak ( text : string )
```

---

## TextField

### Instance Methods

#### `setNumberPadKeyboard`

Instance method setNumberPadKeyboard

#### `setEmailAddressKeyboard`

Instance method setEmailAddressKeyboard

#### `setPhonePadKeyboard`

Instance method setPhonePadKeyboard

#### `setDefaultKeyboard`

Instance method setDefaultKeyboard

#### `setTwitterKeyboard`

Instance method setTwitterKeyboard

#### `setWebSearchKeyboard`

Instance method setWebSearchKeyboard

#### `leftAlignText`

Instance method leftAlignText

#### `rightAlignText`

Instance method rightAlignText

#### `setNumbersAndPunctuationKeyboard`

Instance method setNumbersAndPunctuationKeyboard

#### `setURLKeyboard`

Instance method setURLKeyboard

#### `setDecimalPadKeyboard`

Instance method setDecimalPadKeyboard

#### `centerAlignText`

Instance method centerAlignText

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `isSecure`

Property isSecure

#### `font`

Property font

#### `Device`

Property Device

#### `XMLParser`

Property XMLParser

#### `args`

Property args

#### `placeholder`

Property placeholder

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `text`

Property text

#### `UITable`

Property UITable

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `textColor`

Property textColor

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
addTextField()
```

**Example 2:**
```javascript
addSecureTextField()
```

**Example 3:**
```javascript
text : string
```

**Example 4:**
```javascript
placeholder : string
```

**Example 5:**
```javascript
isSecure : bool
```

---

## Timer

### Static Methods

#### `schedule`

Static method schedule

### Instance Methods

#### `schedule`

Instance method schedule

#### `invalidate`

Instance method invalidate

#### `new Timer`

Instance method new Timer

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `repeats`

Property repeats

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `timeInterval`

Property timeInterval

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
timeInterval : number
```

**Example 2:**
```javascript
repeats : bool
```

**Example 3:**
```javascript
new Timer ()
```

**Example 4:**
```javascript
schedule ( callback : fn ())
```

**Example 5:**
```javascript
invalidate()
```

---

## UITable

### Instance Methods

#### `addRow`

Instance method addRow

#### `removeRow`

Instance method removeRow

#### `present`

Instance method present

#### `new UITable`

Instance method new UITable

#### `reload`

Instance method reload

#### `removeAllRows`

Instance method removeAllRows

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `UITable`

Property UITable

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `showSeparators`

Property showSeparators

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
showSeparators : bool
```

**Example 2:**
```javascript
new UITable ()
```

**Example 3:**
```javascript
addRow ( row : UITableRow )
```

**Example 4:**
```javascript
removeRow ( row : UITableRow )
```

**Example 5:**
```javascript
removeAllRows ()
```

---

## UITableCell

### Static Methods

#### `button`

Static method button

#### `imageAtURL`

Static method imageAtURL

#### `text`

Static method text

#### `image`

Static method image

### Instance Methods

#### `rightAligned`

Instance method rightAligned

#### `leftAligned`

Instance method leftAligned

#### `centerAligned`

Instance method centerAligned

### Properties

#### `onTap`

Property onTap

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `titleFont`

Property titleFont

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `subtitleFont`

Property subtitleFont

#### `DateFormatter`

Property DateFormatter

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `titleColor`

Property titleColor

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetSpacer`

Property WidgetSpacer

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `subtitleColor`

Property subtitleColor

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `widthWeight`

Property widthWeight

#### `dismissOnTap`

Property dismissOnTap

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
widthWeight : number
```

**Example 2:**
```javascript
onTap : fn ()
```

**Example 3:**
```javascript
dismissOnTap : bool
```

**Example 4:**
```javascript
titleColor : Color
```

**Example 5:**
```javascript
subtitleColor : Color
```

---

## UITableRow

### Instance Methods

#### `addImageAtURL`

Instance method addImageAtURL

#### `addText`

Instance method addText

#### `addCell`

Instance method addCell

#### `new UITableRow`

Instance method new UITableRow

#### `addButton`

Instance method addButton

#### `addImage`

Instance method addImage

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `cellSpacing`

Property cellSpacing

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `backgroundColor`

Property backgroundColor

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `height`

Property height

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `onSelect`

Property onSelect

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `isHeader`

Property isHeader

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

#### `dismissOnSelect`

Property dismissOnSelect

### Code Examples

**Example 1:**
```javascript
cellSpacing : number
```

**Example 2:**
```javascript
height : number
```

**Example 3:**
```javascript
isHeader : bool
```

**Example 4:**
```javascript
dismissOnSelect : bool
```

**Example 5:**
```javascript
onSelect : fn ()
```

---

## URLScheme

### Static Methods

#### `parameter`

Static method parameter

#### `allParameters`

Static method allParameters

#### `forOpeningScriptSettings`

Static method forOpeningScriptSettings

#### `forOpeningScript`

Static method forOpeningScript

#### `forRunningScript`

Static method forRunningScript

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `URLScheme`

Property URLScheme

#### `Location`

Property Location

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
scriptable://
```

**Example 2:**
```javascript
scriptable:///add
```

**Example 3:**
```javascript
scriptable:///open/Example
```

**Example 4:**
```javascript
openSettings
```

**Example 5:**
```javascript
scriptable:///run/Example
```

---

## UUID

### Static Methods

#### `string`

Static method string

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `UUID`

Property UUID

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static string () : string
```

**Example 2:**
```javascript
static string () : string
```

---

## WebView

### Static Methods

#### `loadFile`

Static method loadFile

#### `loadHTML`

Static method loadHTML

#### `loadURL`

Static method loadURL

### Instance Methods

#### `getHTML`

Instance method getHTML

#### `waitForLoad`

Instance method waitForLoad

#### `loadURL`

Instance method loadURL

#### `evaluateJavaScript`

Instance method evaluateJavaScript

#### `loadRequest`

Instance method loadRequest

#### `loadFile`

Instance method loadFile

#### `present`

Instance method present

#### `loadHTML`

Instance method loadHTML

#### `new WebView`

Instance method new WebView

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `WebView`

Property WebView

#### `console`

Property console

#### `Path`

Property Path

#### `Message`

Property Message

#### `Safari`

Property Safari

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `shouldAllowRequest`

Property shouldAllowRequest

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
shouldAllowRequest : fn ( Request ) -> bool
```

**Example 2:**
```javascript
new WebView ()
```

**Example 3:**
```javascript
static loadHTML ( html : string , baseURL : string , preferredSize : Size , fullscreen : bool ) : Promise
```

**Example 4:**
```javascript
static loadFile ( fileURL : string , preferredSize : Size , fullscreen : bool ) : Promise
```

**Example 5:**
```javascript
preferredSize
```

---

## WidgetDate

### Instance Methods

#### `applyDateStyle`

Instance method applyDateStyle

#### `applyRelativeStyle`

Instance method applyRelativeStyle

#### `leftAlignText`

Instance method leftAlignText

#### `applyOffsetStyle`

Instance method applyOffsetStyle

#### `rightAlignText`

Instance method rightAlignText

#### `applyTimerStyle`

Instance method applyTimerStyle

#### `centerAlignText`

Instance method centerAlignText

#### `applyTimeStyle`

Instance method applyTimeStyle

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `date`

Property date

#### `font`

Property font

#### `Device`

Property Device

#### `XMLParser`

Property XMLParser

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetText`

Property WidgetText

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `textColor`

Property textColor

#### `minimumScaleFactor`

Property minimumScaleFactor

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `shadowRadius`

Property shadowRadius

#### `shadowOffset`

Property shadowOffset

#### `lineLimit`

Property lineLimit

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `textOpacity`

Property textOpacity

#### `ContactsContainer`

Property ContactsContainer

#### `url`

Property url

#### `shadowColor`

Property shadowColor

### Code Examples

**Example 1:**
```javascript
date : Date
```

**Example 2:**
```javascript
textColor : Color
```

**Example 3:**
```javascript
font : Font
```

**Example 4:**
```javascript
textOpacity : number
```

**Example 5:**
```javascript
lineLimit : number
```

---

## WidgetImage

### Instance Methods

#### `centerAlignImage`

Instance method centerAlignImage

#### `applyFillingContentMode`

Instance method applyFillingContentMode

#### `rightAlignImage`

Instance method rightAlignImage

#### `applyFittingContentMode`

Instance method applyFittingContentMode

#### `leftAlignImage`

Instance method leftAlignImage

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `tintColor`

Property tintColor

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `resizable`

Property resizable

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `imageOpacity`

Property imageOpacity

#### `ContactsGroup`

Property ContactsGroup

#### `cornerRadius`

Property cornerRadius

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetText`

Property WidgetText

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `image`

Property image

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `imageSize`

Property imageSize

#### `borderColor`

Property borderColor

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `borderWidth`

Property borderWidth

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `url`

Property url

#### `ContactsContainer`

Property ContactsContainer

#### `containerRelativeShape`

Property containerRelativeShape

### Code Examples

**Example 1:**
```javascript
image : Image
```

**Example 2:**
```javascript
resizable : bool
```

**Example 3:**
```javascript
imageSize : Size
```

**Example 4:**
```javascript
imageOpacity : number
```

**Example 5:**
```javascript
containerRelativeShape
```

---

## WidgetSpacer

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `length`

Property length

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `WidgetSpacer`

Property WidgetSpacer

#### `Color`

Property Color

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
length : number
```

**Example 2:**
```javascript
length : number
```

---

## WidgetStack

### Instance Methods

#### `layoutHorizontally`

Instance method layoutHorizontally

#### `centerAlignContent`

Instance method centerAlignContent

#### `addText`

Instance method addText

#### `useDefaultPadding`

Instance method useDefaultPadding

#### `addStack`

Instance method addStack

#### `addDate`

Instance method addDate

#### `topAlignContent`

Instance method topAlignContent

#### `bottomAlignContent`

Instance method bottomAlignContent

#### `layoutVertically`

Instance method layoutVertically

#### `addSpacer`

Instance method addSpacer

#### `addImage`

Instance method addImage

#### `setPadding`

Instance method setPadding

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `backgroundColor`

Property backgroundColor

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `backgroundImage`

Property backgroundImage

#### `ContactsGroup`

Property ContactsGroup

#### `cornerRadius`

Property cornerRadius

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetText`

Property WidgetText

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `WidgetStack`

Property WidgetStack

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetSpacer`

Property WidgetSpacer

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `spacing`

Property spacing

#### `borderColor`

Property borderColor

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `size`

Property size

#### `backgroundGradient`

Property backgroundGradient

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `borderWidth`

Property borderWidth

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `url`

Property url

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
backgroundColor : Color
```

**Example 2:**
```javascript
backgroundImage : Image
```

**Example 3:**
```javascript
backgroundGradient : LinearGradient
```

**Example 4:**
```javascript
addSpacer()
```

**Example 5:**
```javascript
spacing : number
```

---

## WidgetText

### Instance Methods

#### `centerAlignText`

Instance method centerAlignText

#### `leftAlignText`

Instance method leftAlignText

#### `rightAlignText`

Instance method rightAlignText

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `font`

Property font

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetText`

Property WidgetText

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetImage`

Property WidgetImage

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetSpacer`

Property WidgetSpacer

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `textColor`

Property textColor

#### `minimumScaleFactor`

Property minimumScaleFactor

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `shadowRadius`

Property shadowRadius

#### `shadowOffset`

Property shadowOffset

#### `lineLimit`

Property lineLimit

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `text`

Property text

#### `RecurrenceRule`

Property RecurrenceRule

#### `textOpacity`

Property textOpacity

#### `ContactsContainer`

Property ContactsContainer

#### `url`

Property url

#### `shadowColor`

Property shadowColor

### Code Examples

**Example 1:**
```javascript
text : string
```

**Example 2:**
```javascript
textColor : Color
```

**Example 3:**
```javascript
font : Font
```

**Example 4:**
```javascript
textOpacity : number
```

**Example 5:**
```javascript
lineLimit : number
```

---

## XMLParser

### Instance Methods

#### `new XMLParser`

Instance method new XMLParser

#### `parse`

Instance method parse

### Properties

#### `didStartElement`

Property didStartElement

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `didEndDocument`

Property didEndDocument

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `string`

Property string

#### `parseErrorOccurred`

Property parseErrorOccurred

#### `didStartDocument`

Property didStartDocument

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `didEndElement`

Property didEndElement

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `foundCharacters`

Property foundCharacters

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
didStartDocument : fn ()
```

**Example 2:**
```javascript
didEndDocument : fn ()
```

**Example 3:**
```javascript
didStartElement : fn ( string , { string : string })
```

**Example 4:**
```javascript
didEndElement : fn ()
```

**Example 5:**
```javascript
foundCharacters : fn ()
```

---

## args

### Properties

#### `urls`

Property urls

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `images`

Property images

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `length`

Property length

#### `siriShortcutArguments`

Property siriShortcutArguments

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `widgetParameter`

Property widgetParameter

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `notification`

Property notification

#### `DateFormatter`

Property DateFormatter

#### `WidgetStack`

Property WidgetStack

#### `plainTexts`

Property plainTexts

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `fileURLs`

Property fileURLs

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `queryParameters`

Property queryParameters

#### `UITable`

Property UITable

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `shortcutParameter`

Property shortcutParameter

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

#### `all`

Property all

### Code Examples

**Example 1:**
```javascript
length : number
```

**Example 2:**
```javascript
all : [ any ]
```

**Example 3:**
```javascript
plainTexts : [ string ]
```

**Example 4:**
```javascript
urls : [ string ]
```

**Example 5:**
```javascript
fileURLs : [ string ]
```

---

## config

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `WidgetSpacer`

Property WidgetSpacer

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `widgetFamily`

Property widgetFamily

#### `DateFormatter`

Property DateFormatter

#### `WidgetStack`

Property WidgetStack

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `runsFromHomeScreen`

Property runsFromHomeScreen

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `runsInAccessoryWidget`

Property runsInAccessoryWidget

#### `Calendar`

Property Calendar

#### `runsInActionExtension`

Property runsInActionExtension

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `runsWithSiri`

Property runsWithSiri

#### `Image`

Property Image

#### `runsInNotification`

Property runsInNotification

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `runsInWidget`

Property runsInWidget

#### `runsInApp`

Property runsInApp

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
runsInApp : bool
```

**Example 2:**
```javascript
runsInActionExtension : bool
```

**Example 3:**
```javascript
runsWithSiri : bool
```

**Example 4:**
```javascript
runsInWidget : bool
```

**Example 5:**
```javascript
runsInAccessoryWidget : bool
```

---

## console

### Static Methods

#### `warn`

Static method warn

#### `log`

Static method log

#### `logError`

Static method logError

#### `error`

Static method error

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
static log ( message : any )
```

**Example 2:**
```javascript
console.error(message)
```

**Example 3:**
```javascript
log(message)
```

**Example 4:**
```javascript
console.log
```

**Example 5:**
```javascript
static warn ( message : any )
```

---

## importModule

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `UITableRow`

Property UITableRow

#### `SFSymbol`

Property SFSymbol

#### `WidgetDate`

Property WidgetDate

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `importModule`

Property importModule

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
importModule ( name : string )
```

**Example 2:**
```javascript
importModule('foo')
```

**Example 3:**
```javascript
importModule('/lib/foo')
```

**Example 4:**
```javascript
importModule
```

**Example 5:**
```javascript
module.exports
```

---

## module

### Properties

#### `UITableCell`

Property UITableCell

#### `QuickLook`

Property QuickLook

#### `config`

Property config

#### `Point`

Property Point

#### `XMLParser`

Property XMLParser

#### `Device`

Property Device

#### `args`

Property args

#### `Request`

Property Request

#### `TextField`

Property TextField

#### `DrawContext`

Property DrawContext

#### `Size`

Property Size

#### `CalendarEvent`

Property CalendarEvent

#### `Timer`

Property Timer

#### `Notification`

Property Notification

#### `ShareSheet`

Property ShareSheet

#### `ContactsGroup`

Property ContactsGroup

#### `Rect`

Property Rect

#### `Script`

Property Script

#### `UUID`

Property UUID

#### `DatePicker`

Property DatePicker

#### `DateFormatter`

Property DateFormatter

#### `Data`

Property Data

#### `RelativeDateTimeFormatter`

Property RelativeDateTimeFormatter

#### `Location`

Property Location

#### `URLScheme`

Property URLScheme

#### `WidgetImage`

Property WidgetImage

#### `module`

Property module

#### `Mail`

Property Mail

#### `LinearGradient`

Property LinearGradient

#### `Alert`

Property Alert

#### `Scriptable Docs`

Property Scriptable Docs

#### `Color`

Property Color

#### `WidgetSpacer`

Property WidgetSpacer

#### `Calendar`

Property Calendar

#### `FileManager`

Property FileManager

#### `Keychain`

Property Keychain

#### `UITable`

Property UITable

#### `WidgetStack`

Property WidgetStack

#### `ListWidget`

Property ListWidget

#### `exports`

Property exports

#### `SFSymbol`

Property SFSymbol

#### `UITableRow`

Property UITableRow

#### `console`

Property console

#### `Path`

Property Path

#### `Safari`

Property Safari

#### `Message`

Property Message

#### `WebView`

Property WebView

#### `WidgetDate`

Property WidgetDate

#### `WidgetText`

Property WidgetText

#### `Photos`

Property Photos

#### `Image`

Property Image

#### `filename`

Property filename

#### `Font`

Property Font

#### `CallbackURL`

Property CallbackURL

#### `Reminder`

Property Reminder

#### `Contact`

Property Contact

#### `Dictation`

Property Dictation

#### `DocumentPicker`

Property DocumentPicker

#### `importModule`

Property importModule

#### `Pasteboard`

Property Pasteboard

#### `Speech`

Property Speech

#### `RecurrenceRule`

Property RecurrenceRule

#### `ContactsContainer`

Property ContactsContainer

### Code Examples

**Example 1:**
```javascript
let circle = importModule ( 'circle' ) let r = 2 let area = circle . area ( r ) log ( 'Area of circle: ' + area )
```

**Example 2:**
```javascript
module . exports . area = ( r ) => { return Math . PI * Math . pow ( r , 2 ) } module . exports . circumference = ( r ) => { return 2 * Math . PI * r }
```

**Example 3:**
```javascript
circumference
```

**Example 4:**
```javascript
importModule
```

**Example 5:**
```javascript
filename : string
```

---


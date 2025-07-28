# Scriptable API Reference

This document contains comprehensive API documentation for Scriptable. Each class is organized with its description, constructor, methods, and properties clearly documented.

## Table of Contents

- [CallbackURL](#callbackurl)
- [Alert](#alert)
- [Calendar](#calendar)
- [CalendarEvent](#calendarevent)
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

---

## CallbackURL

Open x-callback-url requests.

Opens apps that support x-callback-url and waits for a response from the target application. You can find a list of apps that support x-callback-url at x-callback-url.com/apps.

### Constructor

#### `new CallbackURL(baseURL: string)`

Constructs an object that opens x-callback-url requests and waits for a response from the target app.

**Parameters:**
- `baseURL` (string): Base URL of the request. This is usually something like my-app://x-callback-url/action

### Methods

#### `addParameter(name: string, value: string)`

Appends a key/value pair to the base URL as a query parameter. The name and value are automatically encoded. Do not add the x-callback-url parameters, i.e. x-source, x-success, x-error and x-cancel as Scriptable will add those.

**Parameters:**
- `name` (string): Name of the query parameter to add.
- `value` (string): Value of the query parameter to add.

#### `open(): Promise<{string: string}>`

Opens the callback URL.

Opens the target app and waits for the target app to perform the action. The returned promise contains the query parameters supplied by the target app when it invokes the callback. If the action failed in the target app or the action was cancelled, the promise will be rejected. The promise is also rejected if the action times out because the target app did not invoke the callback.

**Return value:**
- `Promise<{string: string}>`: Promise that provides the query parameters supplied by the target app when it invokes the callback.

#### `getURL(): string`

Creates the callback URL.

Creates a callback URL with the specified base URL and query parameters.

**Return value:**
- `string`: Configured callback URL.

---

## Alert

Display an alert.

### Constructor

#### `new Alert()`

Constructs a new alert.

### Properties

#### `title: string`

Title displayed in the alert. Uses the script name by default.

#### `message: string`

Informative text displayed in the alert.

### Methods

#### `addAction(title: string)`

Adds an action button to the alert.

**Parameters:**
- `title` (string): Title of the action.

#### `addCancelAction(title: string)`

Adds a cancel action to the alert.

**Parameters:**
- `title` (string): Title of the action.

#### `addDestructiveAction(title: string)`

Adds a destructive action to the alert.

**Parameters:**
- `title` (string): Title of the action.

#### `addTextField(placeholder: string, text: string): TextField`

Adds a text field to the alert.

**Parameters:**
- `placeholder` (string): Optional placeholder shown when the text field is empty.
- `text` (string): Optional default value of the text field.

**Return value:**
- `TextField`: The added text field.

#### `addSecureTextField(placeholder: string, text: string): TextField`

Adds a secure text field to the alert.

**Parameters:**
- `placeholder` (string): Optional placeholder shown when the text field is empty.
- `text` (string): Optional default value of the text field.

**Return value:**
- `TextField`: The added text field.

#### `present(): Promise<number>`

Presents the alert.

**Return value:**
- `Promise<number>`: Promise that provides the index of the action that was selected when fulfilled.

#### `presentAlert(): Promise<number>`

Presents the alert as an alert.

**Return value:**
- `Promise<number>`: Promise that provides the index of the action that was selected when fulfilled.

#### `presentSheet(): Promise<number>`

Presents the alert as a sheet.

**Return value:**
- `Promise<number>`: Promise that provides the index of the action that was selected when fulfilled.

---

## Calendar

Provides access to calendars.

### Static Methods

#### `forEvents(): Promise<Calendar[]>`

Fetches calendars for events.

**Return value:**
- `Promise<Calendar[]>`: Promise that provides the calendars.

#### `forReminders(): Promise<Calendar[]>`

Fetches calendars for reminders.

**Return value:**
- `Promise<Calendar[]>`: Promise that provides the calendars.

#### `forEventsByTitle(title: string): Promise<Calendar[]>`

Fetches calendars for events with a specific title.

**Parameters:**
- `title` (string): Title of the calendars to fetch.

**Return value:**
- `Promise<Calendar[]>`: Promise that provides the calendars.

#### `forRemindersByTitle(title: string): Promise<Calendar[]>`

Fetches calendars for reminders with a specific title.

**Parameters:**
- `title` (string): Title of the calendars to fetch.

**Return value:**
- `Promise<Calendar[]>`: Promise that provides the calendars.

#### `createForEvents(title: string): Promise<Calendar>`

Creates a calendar for events.

**Parameters:**
- `title` (string): Title of the calendar.

**Return value:**
- `Promise<Calendar>`: Promise that provides the created calendar.

#### `findOrCreateForEvents(title: string): Promise<Calendar>`

Finds or creates a calendar for events.

**Parameters:**
- `title` (string): Title of the calendar.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar.

#### `defaultForEvents(): Promise<Calendar>`

Default calendar for events.

**Return value:**
- `Promise<Calendar>`: Promise that provides the default calendar for events.

#### `defaultForReminders(): Promise<Calendar>`

Default calendar for reminders.

**Return value:**
- `Promise<Calendar>`: Promise that provides the default calendar for reminders.

### Properties

#### `identifier: string`

Calendar identifier.

#### `title: string`

Title of calendar.

#### `isSubscribed: boolean`

Whether the calendar is a subscribed calendar.

#### `allowsContentModifications: boolean`

Whether the calendar allows modifications to its contents.

#### `color: Color`

Color of calendar.

### Methods

#### `save()`

Saves calendar.

#### `remove()`

Removes calendar.

---

## CalendarEvent

Calendar event.

### Constructor

#### `new CalendarEvent()`

Constructs a calendar event.

### Properties

#### `identifier: string`

Identifier of calendar event.

#### `title: string`

Title of calendar event.

#### `location: string`

Location of calendar event.

#### `notes: string`

Notes associated with calendar event.

#### `startDate: Date`

Start date of calendar event.

#### `endDate: Date`

End date of calendar event.

#### `isAllDay: boolean`

Whether the calendar event is an all-day event.

#### `attendees: string[]`

Attendees of calendar event.

#### `availability: string`

Availability during the calendar event.

#### `timeZone: string`

Time zone of calendar event.

#### `calendar: Calendar`

Calendar the event is stored in.

### Methods

#### `save()`

Saves calendar event.

#### `remove()`

Removes calendar event.

#### `presentCreate(): Promise<CalendarEvent>`

Presents view for creating calendar event.

**Return value:**
- `Promise<CalendarEvent>`: Promise that provides the created calendar event.

#### `presentEdit(): Promise<CalendarEvent>`

Presents view for editing calendar event.

**Return value:**
- `Promise<CalendarEvent>`: Promise that provides the updated calendar event.

---

## Color

Represents a color.

### Constructor

#### `new Color(hex: string, alpha: number)`

Constructs a color.

**Parameters:**
- `hex` (string): Hex value.
- `alpha` (number): Alpha value.

### Static Methods

#### `black(): Color`

Black color.

#### `blue(): Color`

Blue color.

#### `brown(): Color`

Brown color.

#### `cyan(): Color`

Cyan color.

#### `darkGray(): Color`

Dark gray color.

#### `gray(): Color`

Gray color.

#### `green(): Color`

Green color.

#### `lightGray(): Color`

Light gray color.

#### `magenta(): Color`

Magenta color.

#### `orange(): Color`

Orange color.

#### `purple(): Color`

Purple color.

#### `red(): Color`

Red color.

#### `white(): Color`

White color.

#### `yellow(): Color`

Yellow color.

#### `clear(): Color`

Clear color.

#### `dynamic(lightColor: Color, darkColor: Color): Color`

Creates a dynamic color.

**Parameters:**
- `lightColor` (Color): Color used in light appearance.
- `darkColor` (Color): Color used in dark appearance.

**Return value:**
- `Color`: Dynamic color.

### Properties

#### `hex: string`

Hex value of color.

#### `red: number`

Red component of color.

#### `green: number`

Green component of color.

#### `blue: number`

Blue component of color.

#### `alpha: number`

Alpha component of color.

---

*Note: This documentation continues with additional classes. The structure shown above demonstrates the proper organization where each class has its own section with clear descriptions, constructors, methods, properties, parameters, and return types.*
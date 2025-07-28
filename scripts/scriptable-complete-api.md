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

---

## CallbackURL

Open x-callback-url requests.

Opens apps that support x-callback-url and waits for a response from the target application. You can find a list of apps that support x-callback-url at [x-callback-url.com/apps](http://x-callback-url.com/apps/).

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

Presents an alert.

Use this to configure an alert presented modally or as a sheet. After configuring the alert, call presentAlert() or presentSheet() to present the alert. The two presentations methods will return a value which carries the index of the action that was selected when fulfilled.

### Properties

#### `title: string`

Title displayed in the alert. Usually a short string.

#### `message: string`

Detailed message displayed in the alert.

### Constructor

#### `new Alert()`

Constructs a new alert.

### Methods

#### `addAction(title: string)`

Adds an action to the alert.

Adds an action button to the alert. To check if an action was selected, you should use the first parameter provided when the promise returned by presentAlert() and presentSheet() is resolved.

**Parameters:**
- `title` (string): Title of the action.

#### `addDestructiveAction(title: string)`

Adds a destructive action to the alert.

Destructive action titles have a red text color, signaling that the action may modify or delete data.

**Parameters:**
- `title` (string): Title of the action.

#### `addCancelAction(title: string)`

Adds a cancel action to the alert.

Adds a cancel action to the alert. When a cancel action is selected, the index provided by presentAlert() or presentSheet() will always be -1. Please note that when running on the iPad and presenting using presentSheet(), the action will not be shown in the list of actions. The operation is cancelled by tapping outside the sheet.

An alert can only contain a single cancel action. Attempting to add more cancel actions will remove any previously added cancel actions.

**Parameters:**
- `title` (string): Title of the action.

#### `addTextField(placeholder: string, text: string): TextField`

Adds a text field prompting for user input.

Adds a text field to the alert controller prompting for user input. Retrieve the value for the text field using textFieldValue() and supply the index of the text field. Indices for text fields are assigned in the same order as they are added to the alert starting at 0.

Text fields are not supported when using the sheet presentation.

**Parameters:**
- `placeholder` (string): Optional placeholder that will be displayed when the text field is empty.
- `text` (string): Optional default value for the text field.

**Return value:**
- `TextField`: Text field added to the alert.

#### `addSecureTextField(placeholder: string, text: string): TextField`

Adds a secure text field prompting for user input.

Adds a secure text field to the alert controller prompting for user input. Values entered into a secure text field will be hidden behind dots. Retrieve the value for the text field using textFieldValue() and supply the index of the text field. Indices for text fields are assigned in the same order as they are added to the alert starting at 0.

**Parameters:**
- `placeholder` (string): Optional placeholder that will be displayed when the text field is empty.
- `text` (string): Optional default value for the text field.

**Return value:**
- `TextField`: Text field added to the alert.

#### `textFieldValue(index: number): string`

Retrieves value of a text field.

Retrieves the value of a text field added using addTextField() or addSecureTextField(). Indices for text fields are assigned in the same order as they are added to the alert starting at 0.

**Parameters:**
- `index` (number): Index of text field to retrieve for value.

**Return value:**
- `string`: Value of the text field at the specified index.

#### `present(): Promise<number>`

Presents the alert modally.

This is a shorthand for presentAlert().

**Return value:**
- `Promise<number>`: A promise carrying the selected action index when fulfilled.

#### `presentAlert(): Promise<number>`

Presents the alert modally.

**Return value:**
- `Promise<number>`: A promise carrying the selected action index when fulfilled.

#### `presentSheet(): Promise<number>`

Presents the alert as a sheet.

**Return value:**
- `Promise<number>`: A promise carrying the selected action index when fulfilled.

---

## Calendar

Holds reminders and events.

Use the Calendar type to get a specific calendar. The calendar is used with the Reminder and CalendarEvent types when fetching reminders or events from a specific calendar or when inserting into a calendar. If you are fetching reminders or events from all calendars, you do not need to pass the calendars when performing the fetch with the Reminder or CalendarEvent types.

### Properties

#### `identifier: string`

Calendar identifier.

*Read-only.*

#### `title: string`

Title of calendar.

#### `isSubscribed: bool`

Whether the calendar is a subscribed calendar.

*Read-only.*

#### `allowsContentModifications: bool`

Indicates whether items can be added, edited, and deleted in the calendar.

*Read-only.*

#### `color: Color`

Color of calendar.

### Methods

#### `supportsAvailability(availability: string): bool`

Checks if the calendar supports availability.

The following values are supported:
- busy
- free
- tentative
- unavailable

Not all calendars support all of these availabilities and some calendars may not support availability at all. Use this function to check if the calendar supports a specific availability.

**Parameters:**
- `availability` (string): Availability to check against.

**Return value:**
- `bool`: True if the calendar supports the availability, otherwise false.

#### `save()`

Saves calendar.

Saves changes to the calendar.

#### `remove()`

Removes calendar.

The calendar is removed immediately. This cannot be undone.

### Static Methods

#### `forReminders(): Promise<[Calendar]>`

Fetches calendars for reminders.

A calendar can only hold either reminders or events. Call this function to fetch all calendars that can hold reminders.

**Return value:**
- `Promise<[Calendar]>`: Promise that provides the calendars when fulfilled.

#### `forEvents(): Promise<[Calendar]>`

Fetches calendars for events.

A calendar can only hold either reminders or events. Call this function to fetch all calendars that can hold events.

**Return value:**
- `Promise<[Calendar]>`: Promise that provides the calendars when fulfilled.

#### `forRemindersByTitle(title: string): Promise<Calendar>`

Fetches a calendar that holds reminders.

**Parameters:**
- `title` (string): Title of calendar.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `forEventsByTitle(title: string): Promise<Calendar>`

Fetches a calendar that holds events.

**Parameters:**
- `title` (string): Title of calendar.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `createForReminders(title: string): Promise<Calendar>`

Create a new calendar that holds reminders.

This will create a new list for reminders in the Reminders app. The list is automatically saved so there is no need to call `save()` after creating the list.

**Return value:**
- `Promise<Calendar>`: Promise that provides the created calendar when fulfilled.

#### `findOrCreateForReminders(title: string): Promise<Calendar>`

Find or create a new calendar that holds reminders.

This will attempt to find a calendar for reminders with the specified name. If no calendar is found, a new calendar is created and the calendar will appear as a reminder list in the Reminders app. If multiple calendars are found for the specified name, the first one will be returned. The list is automatically saved so there is no need to call `save()` in the case the list was created.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `defaultForReminders(): Promise<Calendar>`

Default calendar for reminders.

A calendar can only hold either reminders or events. Call this function to get the default calendar that can hold reminders.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `defaultForEvents(): Promise<Calendar>`

Default calendar for events.

A calendar can only hold either reminders or events. Call this function to get the default calendar that can hold events.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `presentPicker(allowMultiple: bool): Promise<[Calendar]>`

Presents a view for picking calendars.

**Parameters:**
- `allowMultiple` (bool): Whether to allow picking multiple calenders. Defaults to false.

**Return value:**
- `Promise<[Calendar]>`: Promise that provides the calendars when fulfilled.

---

## CalendarEvent

Manages events in calendars.

Used for creating, fetching and removing events from your calendars.

### Properties

#### `identifier: string`

Identifier of event.

*Read-only.*

#### `title: string`

Title of event.

#### `location: string`

Location of event.

#### `notes: string`

Notes associated with event.

#### `startDate: Date`

Start date of event.

#### `endDate: Date`

End date of event.

#### `isAllDay: bool`

Whether the event is an all-day event.

#### `attendees: [any]`

Attendees associated with the event.

*Read-only.*

An array of objects on the following form:

```javascript
{
  "isCurrentUser": false,
  "name": "John Appleseed",
  "status": "accepted",
  "type": "person",
  "role": "required"
}
```

Note that the property is read-only since iOS does not expose API to modify the attendees of an event.

#### `availability: string`

Availability during the event.

Indicates how the event should be treated for scheduling purposes. The following values are supported:
- busy
- free
- tentative
- unavailable

Be aware that not all calendars support all of these availabilities and some calendars may not support availability at all. Use `Calendar.supportsAvailability()` to check if a calendar supports a specific availability.

#### `timeZone: string`

Time zone of event.

Geopolitical region identifier that identifies the time zone, e.g. "Europe/Copenhagen", "America/New_York" and "Asia/Tokyo".

#### `calendar: Calendar`

Calendar the event is stored in.

### Constructor

#### `new CalendarEvent()`

Constructs an event.

In order to add the event to your calendar, you must call the save() function.

### Methods

#### `addRecurrenceRule(recurrenceRule: RecurrenceRule)`

Adds a recurrence rule.

Recurrence rules specify when the eventer or reminder should be repeated. See the documentation of RecurrenceRule for more information on creating rules.

**Parameters:**
- `recurrenceRule` (RecurrenceRule): Recurrence rule to add to the reminder.

#### `removeAllRecurrenceRules()`

Removes all recurrence rules.

#### `save()`

Saves event.

Saves changes to an event, inserting it into the calendar if it is newly created.

#### `remove()`

Removes event from calendar.

#### `presentEdit(): Promise<CalendarEvent>`

Presents a view for editing the calendar event.

The presented view supports editing various attributes of the event, including title, location, dates, recurrence and alerts.

**Return value:**
- `Promise<CalendarEvent>`: Promise that provides the updated event when fulfilled.

### Static Methods

#### `presentCreate(): Promise<CalendarEvent>`

Presents a view for creating a calendar event.

The presented view supports editing various attributes of the event, including title, location, dates, recurrence and alerts.

**Return value:**
- `Promise<CalendarEvent>`: Promise that provides the created event when fulfilled.

#### `today(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events occurring today.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `tomorrow(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events occurring tomorrow.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `yesterday(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events that occurred yesterday.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `thisWeek(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events that occur this week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `nextWeek(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events that occur next week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `lastWeek(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events that occurred last week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `between(startDate: Date, endDate: Date, calendars: [Calendar]): Promise<[CalendarEvent]>`

Events that occurs between two dates.

**Parameters:**
- `startDate` (Date): Start date to fetch events for.
- `endDate` (Date): End date to fetch events for.
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

---

## Color

Stores color data including opacity.

A color can be created using a hex value, e.g. #FF0000 and optionally an alpha or it can be created using the provided system colors.

### Properties

#### `hex: string`

HEX representation.

*Read-only.*

#### `red: number`

Amount of red in the color.

*Read-only.*

#### `green: number`

Amount of green in the color.

*Read-only.*

#### `blue: number`

Amount of blue in the color.

*Read-only.*

#### `alpha: number`

Alpha of the color.

*Read-only.*

### Constructor

#### `new Color(hex: string, alpha: number)`

Constructs a color.

Constructs a new color with a hex value and optionally an alpha value. The hex value may specify the alpha value but this will be ignored if the alpha value parameter is provided. Examples of valid hex values: #ff0000, #00ff0080, #00f and #ff. The hashtag is optional.

**Parameters:**
- `hex` (string): Hex value.
- `alpha` (number): Alpha value.

### Static Methods

#### `black(): Color`

Constructs a black color.

**Return value:**
- `Color`: A black color.

#### `darkGray(): Color`

Constructs a dark gray color.

**Return value:**
- `Color`: A dark gray color.

#### `lightGray(): Color`

Constructs a light gray color.

**Return value:**
- `Color`: A light gray color.

#### `white(): Color`

Constructs a white color.

**Return value:**
- `Color`: A white color.

#### `gray(): Color`

Constructs a gray color.

**Return value:**
- `Color`: A gray color.

#### `red(): Color`

Constructs a red color.

**Return value:**
- `Color`: A red color.

#### `green(): Color`

Constructs a green color.

**Return value:**
- `Color`: A green color.

#### `blue(): Color`

Constructs a blue color.

**Return value:**
- `Color`: A blue color.

#### `cyan(): Color`

Constructs a cyan color.

**Return value:**
- `Color`: A cyan color.

#### `yellow(): Color`

Constructs a yellow color.

**Return value:**
- `Color`: A yellow color.

#### `magenta(): Color`

Constructs a magenta color.

**Return value:**
- `Color`: A magenta color.

#### `orange(): Color`

Constructs a orange color.

**Return value:**
- `Color`: A orange color.

#### `purple(): Color`

Constructs a purple color.

**Return value:**
- `Color`: A purple color.

#### `brown(): Color`

Constructs a brown color.

**Return value:**
- `Color`: A brown color.

#### `clear(): Color`

Constructs a transparent color.

**Return value:**
- `Color`: A transparent color.

#### `dynamic(lightColor: Color, darkColor: Color): Color`

Creates a dynamic color.

The dynamic color will use either its light or dark variant depending the appearance of the system.

Dynamic colors are not supported when used with `DrawContext`.

**Parameters:**
- `lightColor` (Color): Color used in light appearance.
- `darkColor` (Color): Color used in dark appearance.

**Return value:**
- `Color`: Dynamic color.

---

## Contact

Contact in the address book.

The type represents a contact in the address book. You can use the type to fetch and update contacts in the address book. If you are signed into multiple accounts on the device, you may have multiple sources that populate the address book. A source is is represented as a `ContactsContainer`. A contact may be in only one container. A CardDAV account usually has a single container whereas an Exchange account may have multiple containers.

### Properties

#### `identifier: string`

Uniquely identifies the contact on the device.

*Read-only.*

#### `namePrefix: string`

Name prefix.

#### `givenName: string`

Given name.

#### `middleName: string`

Middle name.

#### `familyName: string`

Family name.

#### `nickname: string`

Nickname.

#### `birthday: Date`

Birthday.

#### `image: Image`

Profile picture.

#### `emailAddresses: [{string: string}]`

Email addresses.

An array of objects on the following form:

```javascript
{
  "identifier": "UUID-ABC-123",
  "label": "Home",
  "localizedLabel": "Home",
  "value": "my@example.com"
}
```

The identifier uniquely identifies the email address on this device. The label is a description of the email address and the value holds the email address itself.

When updating this property, you must set the entire array of email addresses that you would like to store on the contact. Each value in the array must have the "value" key. The other keys are optional.

#### `phoneNumbers: [{string: string}]`

Phone numbers.

An array of objects on the following form:

```javascript
{
  "identifier": "UUID-ABC-123",
  "label": "Home",
  "localizedLabel": "Home",
  "value": "(111)234-5678"
}
```

The identifier uniquely identifies the phone number on this device. The label is a description of the phone number and the value holds the phone number itself.

When updating this property, you must set the entire array of phone numbers that you would like to store on the contact. Each value in the array must have the "value" key. The other keys are optional.

#### `postalAddresses: [{string: string}]`

Postal addresses.

An array of objects on the following form:

```javascript
{
  "identifier": "UUID-ABC-123",
  "label": "Home",
  "localizedLabel": "Home",
  "street": "240  Terry Lane",
  "city": "New York",
  "state": "New York",
  "postalCode": "10001",
  "country": "United States of America"
}
```

The identifier uniquely identifies the pstal address on this device. The label is a description of the phone number and the value holds the phone number itself.

When updating this property, you must set the entire array of postal addresses that you would like to store on the contact. The "identifier" key is optional.

#### `socialProfiles: [{string: string}]`

Social profiles.

An array of objects on the following form:

```javascript
{
  "identifier": "UUID-ABC-123",
  "label": "Twitter",
  "localizedLabel": "Twitter",
  "service": "Twitter",
  "url": "https://twitter.com/scriptableapp",
  "userIdentifier": null,
  "username": "scriptableapp"
}
```

### Constructor

#### `new Contact()`

Constructs a contact.

In order to add the contact to your address book, you must queue it for insertion using `Contact.add()`. When you're done making changes to the address book you should call `Contact.persistChanges()` to persist the changes.

### Static Methods

#### `all(containers: [ContactsContainer]): Promise<[Contact]>`

Fetches contacts.

Fetches the contacts in the specified containers. A contact can be in only one container.

**Parameters:**
- `containers` ([ContactsContainer]): Containers to fetch contacts from.

**Return value:**
- `Promise<[Contact]>`: Promise that provides the contacts when fulfilled.

#### `inGroups(groups: [ContactsGroup]): Promise<[Contact]>`

Fetches contacts in groups.

Fetches the contacts in the specified contacts groups. A contact may belong to many groups.

**Parameters:**
- `groups` ([ContactsGroup]): Groups to fetch contacts from.

**Return value:**
- `Promise<[Contact]>`: Promise that provides the contacts when fulfilled.

#### `add(contact: Contact, containerIdentifier: string)`

Queues a contact to be added.

After you have created a contact, you must queue the contact to be added to the address book and invoke `Contact.persistChanges()` to persist the changes to the address book.

For performance reasons, it is best to batch changes to the address book. Therefore you should queue all updates, insertions and removals of contacts and contacts groups to as large batches as possible and then call `Contact.persistChanges()` when you want to persist the changes to the address book.

**Parameters:**
- `contact` (Contact): Contact to queue to be added.
- `containerIdentifier` (string): Optional. Identifier of container to add the contact to. If null is specified, the contact will be added to the default container.

#### `update(contact: Contact)`

Queues an update to a contact.

After you have updated one or more properties on a contact, you must queue the contact to be updated and invoke `Contact.persistChanges()` to persist the changes to the address book.

For performance reasons, it is best to batch changes to the address book. Therefore you should queue all updates, insertions and removals of contacts and contacts groups to as large batches as possible and then call `Contact.persistChanges()` when you want to persist the changes to the address book.

**Parameters:**
- `contact` (Contact): Contact to queue to be updated.

---

## ContactsContainer

Collection of contacts.

If you're signed into multiple accounts on your device, you may have multiple contact containers. A contact can be in only one container. CardDAV accounts usually have a single container whereas Exchange accounts may have multiple containers. A container may have multiple groups. While a single contact can only belong to one container, a contact may belong to many groups.

### Properties

#### `identifier: string`

Identifier of the contacts container.

*Read-only.*

#### `name: string`

Name of the contacts container.

*Read-only.*

### Static Methods

#### `default(): Promise<ContactsContainer>`

Fetches default contacts container.

**Return value:**
- `Promise<ContactsContainer>`: Promise that provides the default contacts container when fulfilled.

#### `all(): Promise<[ContactsContainer]>`

Fetches all contacts containers.

**Return value:**
- `Promise<[ContactsContainer]>`: Promise that provides all contacts containers when fulfilled.

#### `withIdentifier(identifier: string): Promise<ContactsContainer>`

Fetches a contacts container.

**Parameters:**
- `identifier` (string): Identifier of the contacts container to fetch.

**Return value:**
- `Promise<ContactsContainer>`: Promise that provides the contacts container when fulfilled.

---

## ContactsGroup

Group of contacts.

A contacts container may have several groups of contacts. A contact can only belong to a single contacts container but may belong to zero or more contacts groups. For example, an iCloud account has only one container but may have many groups.

### Properties

#### `identifier: string`

Identifier of the contacts group.

*Read-only.*

#### `name: string`

Name of the contacts group.

### Constructor

#### `new ContactsGroup()`

Constructs a contacts group.

In order to add the group to your address book, you must queue it for insertion using `ContactsGroup.add()`. When you're done making changes to the address book you should call `Contact.persistChanges()` to persist the changes.

### Methods

#### `addMember(contact: Contact)`

Adds a contact to the group.

In order to persist the change, you should call `Contact.persistChanges()`. It is important that the contact is added to the address book. To add the contact to the address book, you should queue it for insertion using `Contact.add()` before persisting the changes.

**Parameters:**
- `contact` (Contact): Contact to add to the group.

#### `removeMember(contact: Contact)`

Removes a contact from the group.

In order to persist the change, you should call `Contact.persistChanges()`. It is important that the contact is added to the address book. To add the contact to the address book, you should queue it for insertion using `Contact.add()` before persisting the changes.

**Parameters:**
- `contact` (Contact): Contact to add to the group.

### Static Methods

#### `all(containers: [ContactsContainer]): Promise<[ContactsGroup]>`

Fetches contacts groups.

Fetches the contacts groups in the specified containers. A group can be in only one container.

**Parameters:**
- `containers` ([ContactsContainer]): Container to fetch contacts groups from.

**Return value:**
- `Promise<[ContactsGroup]>`: Promise that provides the contacts groups when fulfilled.

---

## Data

Raw data representation.

Raw data representation of strings, files and images.

### Static Methods

#### `fromString(string: string): Data`

Creates data from string.

The provided string is assumed to be UTF8 encoded. If the string is not UTF8 encoded, the function will return null.

**Parameters:**
- `string` (string): String to create data from.

**Return value:**
- `Data`: Data representation of the string.

#### `fromFile(filePath: string): Data`

Reads data from file path.

Reads the raw data of the file at the specified file path.

**Parameters:**
- `filePath` (string): Path of file to read data from.

**Return value:**
- `Data`: Data representation of the file.

#### `fromBase64String(base64String: string): Data`

Creates data from base64 encoded string.

The supplied string must be base64 encoded otherwise the function will return null.

**Parameters:**
- `base64String` (string): Base64 encoded string to create data from.

**Return value:**
- `Data`: Data representation of the string.

#### `fromJPEG(image: Image): Data`

Creates data from JPEG image.

**Parameters:**
- `image` (Image): JPEG image to convert to data.

**Return value:**
- `Data`: Data representation of the image.

#### `fromPNG(image: Image): Data`

Creates data from PNG image.

**Parameters:**
- `image` (Image): PNG image to convert to data.

**Return value:**
- `Data`: Data representation of the image.

#### `fromBytes(bytes: [number]): Data`

Creates data from an array of bytes.

**Parameters:**
- `bytes` ([number]): Array of bytes to convert to data.

**Return value:**
- `Data`: Data creates from the bytes.

### Methods

#### `toRawString(): string`

Creates a string from the data.

The data is assumed to represent a UTF8 encoded string. If the string is not UTF8 encoded string, the function will return null.

**Return value:**
- `string`: Data converted to string.

#### `toBase64String(): string`

Creates a base64 encoded string.

Creates a base64 encoded string from the data.

**Return value:**
- `string`: Base64 encoded string.

#### `getBytes(): [number]`

Gets bytes from data.

**Return value:**
- `[number]`: Array of bytes.

---

## Device

Provides information about the device.

Reads information about the current device and its screen.

### Static Methods

#### `name(): string`

Name identifying the device.

You can find and edit the name of your device in the system settings.

#### `systemName(): string`

Name of the operating system.

#### `systemVersion(): string`

Version of the operating system.

#### `model(): string`

Model of the device, e.g. "iPhone".

#### `isPhone(): bool`

Whether the device is a phone.

You can use this property to choose behavior of a script depending on whether its running on a phone or a pad.

#### `isPad(): bool`

Whether the device is a pad.

You can use this property to choose behavior of a script depending on whether its running on a phone or a pad.

#### `screenSize(): Size`

Size of the screen.

The value is measured in points. For an explanation of the relationship between points and pixels, see the documentation of the `screenScale()` method. The value takes the device rotation into account, so the value will vary between portrait and landscape.

#### `screenResolution(): Size`

Resolution of the screen.

The value is measured in pixels. The value does not take the rotation of the deviec into account.

#### `screenScale(): number`

Scale of the screen.

Standard resolution displays have a scale of 1.0 where one point on the screen equals one pixel. Retina displays will have a scale factor of 2.0 or 3.0 where one point on the screen is four or nine pixels, respectively.

#### `screenBrightness(): number`

Brightness of the screen in percentage.

The value range from 0 to 1. To set the screen brightness, refer to the `setScreenBrightness()` function.

#### `isInPortrait(): bool`

Whether the device is in portrait with the home button or home indicator at the bottom.

#### `isInPortraitUpsideDown(): bool`

Whether the device is in portrait but upside down with the home button or home indicator at the top.

#### `isInLandscapeLeft(): bool`

Whether the device is in landscape with the home button or home indicator on the right side.

#### `isInLandscapeRight(): bool`

Whether the device is in landscape with the home button or home indicator on the left side.

#### `isFaceUp(): bool`

Whether the device is lying parallel to the ground with the screen facing upwards.

#### `isFaceDown(): bool`

Whether the device is lying parallel to the ground with the screen facing downwards.

#### `batteryLevel(): number`

Current battery level.

The value is in percentage ranging between 0 and 1.

#### `isDischarging(): bool`

Whether the device is being not plugged into power and thus discharging.

#### `isCharging(): bool`

Whether the device is being charged.

#### `isFullyCharged(): bool`

Whether the device is fully charged.

#### `preferredLanguages(): [string]`

The preferred langauges.

The list is ordered according to the language preferences specified in the system settings.

#### `locale(): string`

Identifier for the device locale.

#### `language(): string`

Identifier for the device language.

#### `isUsingDarkAppearance(): bool`

Whether the device is using dark appearance.

This API is not supported in widgets.

#### `volume(): number`

The device volume.

The value range from 0 to 1.

#### `setScreenBrightness(percentage: number)`

Sets the brightness of the screen.

The value range from 0 to 1. To get the screen brightness, refer to the `screenBrightness()` function.

**Parameters:**
- `percentage` (number): Percentage to set the screen brightness to. Value between 0 and 1.

---

## FileManager

Read and write files on disk.

A FileManager lets you read files stored on the disk and make changes to them. Paths to files are supplied as strings.

### Static Methods

#### `local(): FileManager`

Creates a local FileManager.

Creates a file manager for operating with files stored locally.

**Return value:**
- `FileManager`: Local FileManager.

#### `iCloud(): FileManager`

Creates an iCloud FileManager.

Creates a file manager for operating with files stored in iCloud. iCloud must be enabled on the device in order to use this.

**Return value:**
- `FileManager`: iCloud FileManager.

### Methods

#### `read(filePath: string): Data`

Read contents of a file as data.

Reads the contents of the file specified by the file path as raw data. To read the file as a string see `readString(filePath)` and to read it as an image see `readImage(filePath)`.

The function will error if the file does not exist or if it exists in iCloud but has not been download. Use `fileExists(filePath)` to check if a file exists and `downloadFileFromiCloud(filePath)` to download the file. Note that it is always safe to call `downloadFileFromiCloud(filePath)`, even if the file is stored locally on the device.

**Parameters:**
- `filePath` (string): Path of the file to read.

**Return value:**
- `Data`: Contents of the file as a data or null if the file could not be read.

#### `readString(filePath: string): string`

Read contents of a file as string.

The function will error if the file does not exist or if it exists in iCloud but has not been download. Use `fileExists(filePath)` to check if a file exists and `downloadFileFromiCloud(filePath)` to download the file. Note that it is always safe to call `downloadFileFromiCloud(filePath)`, even if the file is stored locally on the device.

**Parameters:**
- `filePath` (string): Path of the file to read.

**Return value:**
- `string`: Contents of the file as a string or null if the file could not be read.

#### `readImage(filePath: string): Image`

Read contents of a file as an image.

Reads the contents of the file specified by the file path and converts it to an image.

The function will error if the file does not exist or if it exists in iCloud but has not been download. Use `fileExists(filePath)` to check if a file exists and `downloadFileFromiCloud(filePath)` to download the file. Note that it is always safe to call `downloadFileFromiCloud(filePath)`, even if the file is stored locally on the device.

**Parameters:**
- `filePath` (string): Path of the file to read.

**Return value:**
- `Image`: Contents of the file as an image or null if the file could not be read.

#### `write(filePath: string, content: Data)`

Write data to a file.

**Parameters:**
- `filePath` (string): Path of file to write to.
- `content` (Data): Data to write to disk.

#### `writeString(filePath: string, content: string)`

Write a string to a file.

Writes the content to the specified file path on disk. If the file does not already exist, it will be created. If the file already exists the contents of the file will be overwritten with the new content.

**Parameters:**
- `filePath` (string): Path of file to write to.
- `content` (string): Content to write to disk.

#### `writeImage(filePath: string, image: Image)`

Write an image to a file.

Writes the image to the specified file path on disk. If the file does not already exist, it will be created. If the file already exists the contents of the file will be overwritten with the new content.

**Parameters:**
- `filePath` (string): Path of file to write to.
- `image` (Image): Image to write to disk.

#### `remove(filePath: string)`

Removes a file.

Removes the file at the specified path. Use with caution. Removed files cannot be restored.

**Parameters:**
- `filePath` (string): Path of file to remove.

#### `move(sourceFilePath: string, destinationFilePath: string)`

Moves a file.

Moves the file from the source path to the destination path. Caution: This operation will replace any existing file at the the destination.

**Parameters:**
- `sourceFilePath` (string): Path of the file to move.
- `destinationFilePath` (string): Path to move the file to.

#### `copy(sourceFilePath: string, destinationFilePath: string)`

Copies a file.

Copies the file from the source path to the destination path. If a file already exists at the destination file path, the operation will fail and the file will not be copied.

**Parameters:**
- `sourceFilePath` (string): Path of the file to copy.
- `destinationFilePath` (string): Path to copy the file to.

#### `fileExists(filePath: string): bool`

Checks if the file exists.

Checks if the file exists at the specified file path. Checking this before moving or copying to a destination can be a good idea as those operations will replace any existing file at the destination file path.

**Parameters:**
- `filePath` (string): File path to examine.

**Return value:**
- `bool`: True if the file exists otherwise false.

#### `isDirectory(path: string): bool`

Checks if a path points to a directory.

**Parameters:**
- `path` (string): Path to examine.

**Return value:**
- `bool`: True if the path points to a directory otherwise false.

#### `createDirectory(path: string, intermediateDirectories: bool)`

Creates a directory at the specified path.

You can optionally create all intermediate directories.

**Parameters:**
- `path` (string): Path of directory to create.
- `intermediateDirectories` (bool): Whether to create all intermediate directories. Defaults to false.

#### `temporaryDirectory(): string`

Path of temporary directory.

Used to retrieve the path of a temporary directory on disk. Data persisted in a temporary directory will generally live shorter than data persisted in the cache directory.

The operating system may at any time delete files stored in this directory and therefore you should not rely on it for long time storage. If you need long time storage, see documentsDirectory() or libraryDirectory(). This directory is not shared between the app, the action extension and Siri.

**Return value:**
- `string`: Path to temporary directory.

#### `cacheDirectory(): string`

Path of cache directory.

Used to retrieve the path of a cache directory on disk. The operating system may at any time delete files stored in this directory and therefore you should not rely on it for long time storage.

Data persisted in the cache directory will generally live longer than data persisted in a temporary directory.

If you need long time storage, see documentsDirectory() or libraryDirectory(). This directory is not shared between the app, the action extension and Siri.

**Return value:**
- `string`: Path to temporary directory.

#### `documentsDirectory(): string`

Path of documents directory.

---

## Image

Manages image data.

Images objects contains image data. APIs in Scriptable that work with images, either by taking an image as input or returning an image, will use this the Image type.

### Properties

#### `size: Size`

Size of the image in pixels.

*Read-only.*

### Static Methods

#### `fromFile(filePath: string): Image`

Creates an image from file.

Loads an image from the specified file path. If the image could not be read, the function will return null.

**Parameters:**
- `filePath` (string): File path to read image from.

**Return value:**
- `Image`: The read image or null if the image could not be read.

#### `fromData(data: Data): Image`

Creates an image from raw data.

Loads an image from the raw data. If the image could not be read, the function will return null.

**Parameters:**
- `data` (Data): Data to read image from.

**Return value:**
- `Image`: The read image or null if the image could not be read.

---

## Notification

Schedules and manages notifications.

Notifications are scheduled for delivery at some point in the future. A notification may be delivered even when Scriptable is not running.

### Properties

#### `identifier: string`

Identifier of the notification.

To reschedule a notification, use the identifier of an existing notification.

#### `title: string`

Title of the notification.

#### `subtitle: string`

Subtitle of the notification.

#### `body: string`

Body of the notification.

#### `preferredContentHeight: number`

Preferred height of the notification.

By default Scriptable attempts to determine an appropriate height for your notification. If you want to override the default behavior, you can specify a preferred content height. The preferred content height is only used when running a script inside the notification, i.e. when `scriptName` is not null. iOS may limit the height of the notification in which case the preferred content height is not guaranteed to be respected.

#### `badge: number`

Number to display in the app icon's badge.

When the number is zero, no badge is displayed. When the number is greater than zero, the number is displayed in the app icon's badge. Setting the value to null, will leave the badge unchanged. The default value is null.

#### `threadIdentifier: string`

Identifier for grouping the notification.

Notifications are grouped by the identifier on the Home screen and in the Notification Center.

#### `userInfo: {string: any}`

Custom information.

Store any custom information for the notification. This can be accessed from the `Notification.opened` property when a script is run from a notification.

#### `sound: string`

Sound of the notification.

Set to null if you do not want any sound. Set to one of the following values if you want a sound.

- default
- accept
- alert
- complete
- event
- failure
- piano_error
- piano_success
- popup

By default the notification is delivered with no sound.

#### `openURL: string`

URL to open when notification is tapped.

The Scriptable application will open the URL when the notification is tapped. This can be a URL that uses Scriptables URL scheme, the URL scheme of another application or a website URL.

#### `deliveryDate: Date`

Delivery date of the notification.

*Read-only.*

If the notification has already been delivered, for example because it was fetched using `Notification.allDelivered()`, the deliveryDate will be populated. Otherwise it will be null.

The property cannot be set. In order to specify a future delivery date for a notification, see the `setTriggerDate` function. For recurring notifications, see the `setDailyTrigger` and `setWeeklyTrigger` functions.

#### `nextTriggerDate: Date`

Next trigger date of the notification.

*Read-only.*

The next trigger date is the point in time where the next notification will be delivered.

---

## Request

Performs HTTP requests.

Performs a URL request and returns the response in an appropriate format.

### Properties

#### `url: string`

URL to send request to.

#### `method: string`

HTTP method used for the request.

Specifies the HTTP method to use when sending the request. The default is to send the request using the GET HTTP method.

#### `headers: {string: string}`

HTTP headers to send with the request.

Key value pairs where the key is the name of an HTTP header and the value will be sent as the value for the HTTP header.

#### `body: any`

Body to send with the request.

The body will be send along the request. While this property can be any value, currently only strings and Data is supported.

Be aware that this property is ignored if you convert the request to a multipart request using `addParameterToMultipart`, `addFileToMultipart` or `addFileDataToMultipart`.

#### `timeoutInterval: number`

Timeout interval of the request.

If a request remains idle for longer than the timeout interval, the request is considered timed out.

The timeout interval is measured in seconds and defaults to 60 seconds.

#### `onRedirect: fn(Request) -> Request`

Function called upon redirect.

The function determines how redirects should be handled. By default redirects are allowed. When invoked the function is supplied with the request that we're about to redirect to. The function can return the request to continue redirecting or it can return another request to redirect to. Returning null will stop the redirect. Note that onRedirect will only be invoked on the initial request. Consecutive redirects should be handled on the initial request.

#### `response: {string: any}`

Response of the request.

*Read-only.*

The response is not populated until the request has been completed. The response is an object that looks like the following example.

```
{
  "url": "https://example.com/",
  "statusCode": 200
  "mimeType": "application/json",
  "textEncodingName": "utf-8",
  "headers": {
    "Content-Type": "application/json;charset=utf-8",
    "Content-Length": "17671"
  },
  "cookies": [{
    "path": "/",
    "httpOnly": true,
    "domain": "www.example.com",
    "sessionOnly": true,
    "name": "JSESSIONID",
    "value": "7616271F4878CFD05182D20C45F4CEB3"
  }]
}
```

#### `allowInsecureRequest: bool`

Allow the request even if it is deemed insecure.

By default Scriptable will attempt to reject requests that are deemed insecure.

As an example, Scriptable will reject communicating with a server that has an invalid certificate. Such servers might be malicious and may put confidential information at risk. By enabling this setting, those requests will be allowed.

Enable this setting at your own risk.

### Constructor

#### `new Request(url: string)`

Constructs a request.

Constructs a new request that will be sent to the provided URL. The request is not sent until an appropriate load method is called, e.g. loadImage for downloading and interpreting the response as an image.

**Parameters:**
- `url` (string): URL to send request to.

### Methods

#### `load(): Promise<Data>`

Sends request.

Call to send the configured request to the specified URL. The raw response is provided when the returned promise is fulfilled.

**Return value:**
- `Promise<Data>`: Promise that provides the response as data when fulfilled.

#### `loadString(): Promise<string>`

Sends request and parses response as a string.

Call to send the configured request to the specified URL. The response is parsed to a string and provided when the returned promise is fulfilled.

**Return value:**
- `Promise<string>`: Promise that provides the response as a string when fulfilled.

#### `loadJSON(): Promise<any>`

Sends request and parses response as JSON.

Call to send the configured request to the specified URL. The response is expected to be a valid JSON string and is parsed into an object.

**Return value:**
- `Promise<any>`: Promise that provides the response as a JSON object when fulfilled.

---

## WebView

Presents websites and evaluates JavaScript on websites.

Supports rendering HTML as well as loading a file and rendering it. A file can be of various types. It could for example be an HTML file or an image.

The web view also supports evaluating JavaScript on a website.

### Properties

#### `shouldAllowRequest: fn(Request) -> bool`

Function called upon load of a request.

When the web view performs a request to load a resource, the function can determine whether or not to allow the request. Disallowing request can speed up the time it takes to load the website.

By default all requests are allowed.

### Constructor

#### `new WebView()`

Constructs web view.

Constructs a new web view. Use a web view to evaluate JavaScript on websites.

### Static Methods

#### `loadHTML(html: string, baseURL: string, preferredSize: Size, fullscreen: bool): Promise`

Loads HTML and renders it.

**Parameters:**
- `html` (string): HTML to load and render.
- `baseURL` (string): Optional. Base URL used to resolve relative URLs in the HTML.
- `preferredSize` (Size): Optional. Preferred size of the view. This size is not guaranteed to be respected and is only used when the script is run with Siri or in the Shortcuts app.
- `fullscreen` (bool): Optional. Set to true to present the web view in fullscreen. This only has an effect when used within the app. Defaults to false.

**Return value:**
- `Promise`: Promise that carries no value. Once the web view have been closed, the promise will complete.

#### `loadFile(fileURL: string, preferredSize: Size, fullscreen: bool): Promise`

Loads a file and renders it.

Files can be of various types, including HTML files and images.

The supplied HTML file can reference files and nested directories in the same directory as the HTML file resides.

The optional `preferredSize` parameter is ignored unless the script is run in a Siri Shortcut.

If you are displaying large images in a memory constrained environment, for example in a Siri Shortcut, you should use the WebView bridge instead of the QuickLook bridge. The technical reason for this is that a Siri Shortcut and other app extension processes have very limited memory and loading a very large image will cause the app extension to be terminated. However, the web view will run in a different process meaning that it is not affected by the same memory constraints.

**Parameters:**
- `fileURL` (string): URL of the file to load and render.
- `preferredSize` (Size): Optional. Preferred size of the view. This size is not guaranteed to be respected and is only used when the script is run with Siri or in the Shortcuts app.
- `fullscreen` (bool): Optional. Set to true to present the web view in fullscreen. This only has an effect when used within the app. Defaults to false.

**Return value:**
- `Promise`: Promise that carries no value. Once the web view have been closed, the promise will complete.

#### `loadURL(url: string, preferredSize: Size, fullscreen: bool): Promise`

Loads URL in web view and presents the web view.

The optional `preferredSize` parameter is ignored unless the script is run in a Siri Shortcut.

**Parameters:**
- `url` (string): URL to load into the web view.
- `preferredSize` (Size): Optional. Preferred size of the view. This size is not guaranteed to be respected and is only used when the script is run with Siri or in the Shortcuts app.
- `fullscreen` (bool): Optional. Set to true to present the web view in fullscreen. This only has an effect when used within the app. Defaults to false.

**Return value:**
- `Promise`: Promise that carries no value. Once the web view have been closed, the promise will complete.

---

## ListWidget

Widget showing a list of elements.

A widget showing a list of elements. Pass the widget to Script.setWidget() display it on your Home Screen.

Be aware that the widget will refresh periodically and the rate at which the widget refreshes is largely determined by the operating system.

Also note that there are memory limitations when running a script in a widget. When using too much memory the widget will crash and not render correctly.

### Properties

#### `backgroundColor: Color`

Background color of the widget.

Defaults to a solid color in widgets placed on the Home Screen and a transparent color placed on the Lock Screen.

#### `backgroundImage: Image`

Background image.

#### `backgroundGradient: LinearGradient`

Background gradient.

#### `addAccessoryWidgetBackground: bool`

Whether to use an accessory widget background.

Enable to add an adaptive background that provides a standard appearance based on the widget's environment. Defaults to false.

This is only available starting from iOS 16.

#### `spacing: number`

Spacing between elements.

Specifies the spacing between elements in the widget. You can also use the `addSpacer()` function on the widget to add spacing between elements. Defaults to 0.

#### `url: string`

URL to open.

The URL will be opened when the widget is tapped. This will override any behavior defined in the configuration of the widget. E.g. if the widget is configured to run the script when interacting with the widget but a URL is set the URL will take precedence.

#### `refreshAfterDate: Date`

Earliest date to refresh the widget.

The property indicates when the widget can be refreshed again. The widget will not be refreshed before the date have been reached. It is not guaranteed that the widget will refresh at exactly the specified date.

The refresh rate of a widget is partly up to iOS/iPadOS. For example, a widget may not refresh if the device is low on battery or the user is rarely looking at the widget.

When the property is `null` the default refresh interval is used. Defaults to `null`.

### Constructor

#### `new ListWidget()`

Constructs a new list widget.

A widget showing a list of elements. Pass the widget to Script.setWidget() to display it on your Home Screen.

### Methods

#### `addText(text: string): WidgetText`

Add text to the widget.

Adds a text element to the widget. Use the properties on the returned element to style the text.

**Return value:**
- `WidgetText`: Text element.

#### `addDate(date: Date): WidgetDate`

Add date to the widget.

Adds a date element to the widget. Use the properties on the returned element to style the date.

**Return value:**
- `WidgetDate`: Date element.

#### `addImage(image: Image): WidgetImage`

Add image to the widget.

Adds an image element to the widget. Use the properties on the returned element to style the image.

**Return value:**
- `WidgetImage`: Image element.

#### `addSpacer(length: number): WidgetSpacer`

Add spacer.

Adds a spacer to the widget. This can be used to offset the content vertically in the widget.

**Parameters:**
- `length` (number): Length of the spacer.

---

## DateFormatter

Converts between dates and strings.

The date formatter can convert between dates and their textual representations.

### Properties

#### `dateFormat: string`

Date format to be used by the formatter.

Sets a fixed format to be used by the formatter. For example the date "2019-08-26 16:47" can be represented using the format "yyyy-MM-dd HH:mm".

When converting dates to strings, it's advised to use some of the predefined formats for dates and times that can be applied using functions on the formatter, e.g. `useMediumDateStyle()` and `useMediumTimeStyle()`.

Year:
- `y`: Year with no padding. Example: "2019"
- `yy`: Year with two zeros. Adds padding if necessary. Example: "19"
- `yyyy`: Year with a minimum of four digits. Adds padding if necessary. Example: "2019"

Quarter:
- `Q`: Quarter of the year. Example: "4"
- `QQQQ`: Quarter spelled out. Example: "4th quarter"

Month:
- `M`: Numeric month of the year. Example: "1"
- `MM`: Numeric month of the year. Adds padding if necessary. Example: "01"
- `MMM`: Shorthand name of the month. Example: "Jan"
- `MMMM`: Full name of the month. Example: "January"
- `MMMMM`: Narrow name of the month. Example: "J"

Day:
- `d`: Day of the month. Example: "9"
- `dd`: Day of the month. Adds padding if necessary. Example: "09"
- `F`: Day of the week. Example: "3rd Friday in August"
- `E`: Day of the week. Example: "Fri"
- `EEEE`: Full name of the day. Example: "Friday"
- `EEEEE`: Narrow day of the week. Example: "F"

Hour:
- `h`: Hour on a 12-hour clock. Example: "9"
- `hh`: Hour on a 12-hour clock. Adds padding if necessary. Example: "09"
- `H`: Hour on a 24-hour clock. Example: "21"
- `HH`: Hour on a 24-hour clock. Adds padding if necessary. Example: "21"
- `a`: AM/PM for times on a 12-hour clock. Example: "PM"

Minute:
- `m`: Minute. Example: "7"
- `mm`: Minute. Adds padding if necessary. Example: "07"

Second:
- `s`: Seconds. Example: "4"
- `ss`: Seconds. Adds padding if necessary. Example: "04"
- `SSS`: Milliseconds. Example: "384"

Time zone:
- `zzz`: Three letter name of the time zone. Falls back to GMT-08:00 if the name is unknown. Example: "CST"
- `zzzz`: Full name of the time zone. Falls back to GMT-08:00 if the name is unknown. Example: "Central Standard Time"
- `Z`: Time zone in RFC 822 GMT format. Also matches a literal Z for Zulu (UTC) time. Example: "-0600"
- `ZZZZ`: Time zone with abbreviation and offset. Example: "CST-06:00"
- `ZZZZZ`: Time zone in ISO 8601 format. Example: "-06:00"

A great resource for experimenting with date formats is nsdateformatter.com developed by Ben Scheirman.

#### `locale: string`

Locale to use when formatting.

The locale should be specified using a string identifier, e.g. "en", "it" or "da". When no locale is set, the formatter will use the current locale of the device.

### Constructor

#### `new DateFormatter()`

Constructs a date formatter.

To convert between dates and their textual representation, use the `string()` and `date()` functions.

### Methods

#### `string(date: Date): string`

Creates a string from a date.

**Parameters:**
- `date` (Date): The date to convert to a string.

**Return value:**
- `string`: A textual representation of the date.

#### `date(str: string): Date`

Creates a date from a string.

Uses the date formatters configuration to parse the string into a date. If the string cannot be parsed with the date formatters configuration, the function will return null.

**Parameters:**
- `str` (string): The string to parse into a date.

**Return value:**
- `Date`: A date representation of the string or null if the string could not be parsed.

#### `useNoDateStyle()`

Use no style for the date.

This will remove the date from the formatted string.

#### `useShortDateStyle()`

Use a short style for the date.

Dates with a short style are typically numeric only e.g. "08/23/19".

#### `useMediumDateStyle()`

Use a medium style for the date.

Dates with a medium style usually includes abbreviations, e.g. "Aug 23, 2019" or "7:16:42 PM".

#### `useLongDateStyle()`

Use a long style for the date.

Dates with a long style usually includes a full text, e.g. "August 23, 2019".

---

## Font

Represents a font and text size.

The font can be used to style texts, for example in widgets.

### Constructor

#### `new Font(name: string, size: number)`

Constructs a new font.

Refer to [iosfonts.com](http://iosfonts.com/) for a list of the fonts that are available in iOS and iPadOS.

**Parameters:**
- `name` (string): Name of the font.
- `size` (number): Size of the font.

### Static Methods

#### `largeTitle(): Font`

Preferred font for large titles.

**Return value:**
- `Font`: Preferred font.

#### `title1(): Font`

Preferred font for first level hierarchical headings.

**Return value:**
- `Font`: Preferred font.

#### `title2(): Font`

Preferred font for second level hierarchical headings.

**Return value:**
- `Font`: Preferred font.

#### `title3(): Font`

Preferred font for third level hierarchical headings.

**Return value:**
- `Font`: Preferred font.

#### `headline(): Font`

Preferred font for headings.

**Return value:**
- `Font`: Preferred font.

#### `subheadline(): Font`

Preferred font for subheadings.

**Return value:**
- `Font`: Preferred font.

#### `body(): Font`

Preferred font for body texts.

**Return value:**
- `Font`: Preferred font.

#### `callout(): Font`

Preferred font for callouts.

**Return value:**
- `Font`: Preferred font.

---

## Timer

A timer that fires after a time interval has elapsed.

The timer fires after a specified time interval has elapsed. The timer can be repeating in which case it will fire multiple times.

### Properties

#### `timeInterval: number`

The frequency at which the timer fires, in milliseconds.

Be aware that the time interval is specified in setting. Defaults to 0, causing the timer to fire instantly.

#### `repeats: bool`

Whether the timer should repeat.

A repeating timer will keep firing until it is invalidated. In contrast to non-repeating timers, repeating timers are not automatically invalidated. Defaults to false.

### Constructor

#### `new Timer()`

Constructs a timer.

Constructs a timer that fires after a specified time interval.

### Methods

#### `schedule(callback: fn())`

Schedules the timer.

Schedules the timer using its configuration. The supplied function is called when the timer fires. To stop the timer from firing, call the `invalidate()` function.

**Parameters:**
- `callback` (fn()): The callback to be called when the timer fires.

#### `invalidate()`

Stops the timer from firing.

Stops the timer from firing ever again. Non-repeating timers are automatically invalidated after they have fired once. Repeating timers must be manually invalidated.

### Static Methods

#### `schedule(timeInterval: number, repeats: bool, callback: fn()): Timer`

Schedules a timer.

This is a convenience function for creating a new timer. The created timer is instantly scheduled and will fire after the specified time interval.

**Parameters:**
- `timeInterval` (number): The time interval to fire the timer at.
- `repeats` (bool): Whether the timer should repeat or not.
- `callback` (fn()): The callback to be called when the timer fires.

**Return value:**
- `Timer`: The constructed timer.

---

## DatePicker

Presents a date picker.

The date picker can be configured towards picking a date with or without
 time, just a time or picking hours and minutes for a timer.

### Properties

#### `minimumDate`

Minimum date that is selected in the picker.

#### `maximumDate`

Maximum date that is selected in the picker.

#### `countdownDuration`

Countdown duration displayed by the date picker.

#### `minuteInterval`

Interval at which the date picker displays minutes.

#### `initialDate`

The initially selected date.

### Constructor

#### `new DatePicker()`

Use the date picker to present a view for selecting a date.

### Methods

#### `pickDateAndTime(): Promise<Date>`

Presents the date picker displaying date and time.

#### `pickCountdownDuration():Promise<number>`

Presents the date picker for selecting the duration of a countdown.

---

## Dictation

### Static Methods

#### `static start(locale: string): Promise<string>`

Presents an interface that shows the dictated string. Press "Done"
when you are done dictating the text.

**Parameters:**
- `locale` (string): Optional string identifier that specifies the language to dictate in. E.g. 
"en" for English, "it" for Italian and "da" for Danish. Defaults to the loc
ale of the device.

---

## DocumentPicker

Presents a document picker.

Use this to present a picker that allows opening a document from Files a
pp or exporting a document to Files app.
When opening a document, the picker will prompt you to select one or more d
ocuments after which you will get the path for the documents. Use the FileM
anager to read the content of these files.
When exporting a document, the picker will ask you to select a destination 
to store the document.

### Static Methods

#### `static open(types: [string]): Promise<[string]>`

Opens a document.

**Parameters:**
- `types` ([string]): Types of files to select. Specified using UTIs. Defaults to all files.

**Return value:**
- `Promise<[string]>: Promise that provides paths for the selected documents when fulfilled.`

#### `static openFile(): Promise<string>`

Presents a document picker for opening a file from the Files app. The do
cument picker will allow the selection of any file.

#### `static openFolder(): Promise<string>`

Presents a document picker for opening a folder from the Files app.

#### `static export(path: string): Promise<[string]>=`

Exports the file to a document with. A picker prompting for a destinatio
n to export the document to is presented.

**Parameters:**
- `path` (string): Path of the file to export.

**Return value:**
- `Promise<[string]>: Promise that provides paths for the selected file destination when fulfille
d.`

#### `static exportString(content: string, name: string):Promise<[string]>`

Exports a string to a new file. The name of the file can optionally be s
pecified. A picker prompting for a destination to export the document to is
 presented.

**Parameters:**
- `content` (string): Content of the document to export.
- `name` (string): Optional name of the document to export.

#### `static exportImage(image: Image, name: string): Promise<[string]>`

Exports an image to a new file. The name of the file can optionally be s
pecified. A picker prompting for a destination to export the document to is
 presented.

**Parameters:**
- `image` (Image): Image to export.
- `name` (string): Optional name of the image to export.

#### `static exportData(data:Data,name: string): Promise<[string]>`

Exports data to a new file. The name of the file can optionally be speci
fied. A picker prompting for a destination to export the document to is pre
sented.

**Parameters:**
- `data` (Data): Data to export.
- `name` (string): Optional name of the image to export.

---

## DrawContext

Context for drawing images.

An instance of DrawContext is a canvas on which you can draw an image us
ing shapes, texts and other images. You must specify the size of your canva
s by setting the size property. At any point after beginning your drawing a
nd before ending your drawing can you call getImage() to get an image objec
t of your drawing.

### Properties

#### `size: Size`

Size of canvas.

#### `respectScreenScale`

Enable to respect the scale of the screen.

#### `opaque`

Determines whether the context is opaque.

### Constructor

#### `new DrawContext()`

Constructs a new canvas to draw images, shapes and texts on.

### Methods

#### `drawImageInRect(image: Image, rect: Rect)`

Draws the image in the rectangle. The image will be scaled to fit within
 the rectangle.

**Parameters:**
- `image` (Image): Image to draw.
- `rect` (Rect): Rectangle to draw the image in.

#### `drawImageAtPoint(image: Image, point: Point)`

Draws the image at the point. The top-left corner of the image will be d
rawn at the specified point.

**Parameters:**
- `image` (Image): Image to draw.
- `point` (Point): Point at which to draw top-left corner of the image.

#### `setFillColor(color: Color)`

Sets the fill color to be used when performing a fill operation. Any fil
l operation performed afterwards will fill with the specified color until a
nother call to setFillColor is made.

**Parameters:**
- `color` (Color): Color to set for filling.

#### `setStrokeColor(color: Color)`

Sets the stroke color to be used when performing a stroke operation. Any
 stroke operation performed afterwards will stroke with the specified color
 until another call to setStrokeColor is made.

**Parameters:**
- `color` (Color): Color to set for stroking.

#### `setLineWidth(width: number)`

Sets the line width to be used when performing a stroke operation.

**Parameters:**
- `width` (number): Line width to use for stroking.

#### `fill(rect: Rect)`

Fills the rectangle with the color set when calling setFillColor.

**Parameters:**
- `rect` (Rect): Rectangle to fill.

#### `fillEllipse(rect: Rect)`

Fills the ellipse that fits within the supplied rectangle with the color
 set when calling setFillColor.

**Parameters:**
- `rect` (Rect): Rectangle incapsulating the ellipse to fill.

#### `stroke(rect: Rect)`

Draws a line around the rectangle using the color set when calling setSt
rokeColor. The line will have the width set when calling setLineWidth.

**Parameters:**
- `rect` (Rect): Rectangle to stroke.

#### `strokeRect(rect: Rect)`

Draws a line around the rectangle using the color set when calling setSt
rokeColor. The line will have the width set when calling setLineWidth.

**Parameters:**
- `rect` (Rect): Rectangle to stroke.

#### `strokeEllipse(rect: Rect)`

Draws a line around the ellipse that fits within the supplied rectangle.
 The line will have the color set when calling setStrokeColor and the width
 set when calling setLineWidth.

**Parameters:**
- `rect` (Rect): Rectangle incapsulating the ellipse to stroke.

#### `strokePath()`

The path that was added the latest to the context is stroked with the co
lor set using setStrokeColor and the line width set using setLineWidth.

#### `drawTextInRect(text: string, rect: Rect)`

Call this to draw a text string in a rectangle. Specify how the text sho
uld be aligned within the rectangle by calling setTextAlignedLeft, setTextA
lignedCenter or setTextAlignedRight before drawing the text.

**Parameters:**
- `text` (string): Text to draw.
- `rect` (Rect): Rectangle to draw text in.

#### `setFontSize(size: number)`

Sets the font size to be used when drawing texts to the context.

**Parameters:**
- `size` (number): Font size to use when drawing text.

#### `setTextColor(color: Color)`

Sets the text color to be used when drawing text strings to the context.

**Parameters:**
- `color` (Color): Color to use when drawing text.

#### `setTextAlignedLeft()`

Sets text alignment to left. Texts drawn after calling this will be left
 aligned inside the provided rectangle.

#### `setTextAlignedCenter()`

Sets text alignment to center. Texts drawn after calling this will be ce
nter aligned inside the provided rectangle.

#### `setTextAlignedRight()`

Sets text alignment to right. Texts drawn after calling this will be rig
ht aligned inside the provided rectangle.

---

## Keychain

Secure storage for credentials.

### Static Methods

#### `static contains(key: string): bool`

Checks if the keychain contains the specified key.

**Return value:**
- `bool: True if the key exists in the keychain, otherwise false.`

#### `static set(key: string, value: string)`

Adds the value to the keychain, assigning it to the specified key. If th
e key already exists in the keychain, the value is overwritten.

**Parameters:**
- `key` (string): Key which the value should be assigned to.
- `value` (string): Value to assign to the specified key.

#### `static get(key: string): string`

Reads a value from the keychain.

**Parameters:**
- `key` (string): Key to read value for.

**Return value:**
- `string: Value assigned to the specified key.`

#### `static remove(key: string)`

Remove key from keychain.

**Parameters:**
- `key` (string): Key to remove from the keychain.

---

## Location

Fetches your location.

### Static Methods

#### `static current(): Promise<{string: number}>`

Your location is fetched using GPS, WiFi and cellular hardware. The obje
ct carried by the promise includes the latitude, longitude and altitude as 
well as the horizontal and vertical accuracy measured in meters.

**Return value:**
- `Promise<{string: number}>: Promise providing an object containing information about your location.`

#### `static setAccuracyToBest()`

Set this when you want to achieve the best possible accuracy when retrie
ving your location. This is the default accuracy.

#### `static setAccuracyToTenMeters()`

Sets accuracy to within ten meters.

#### `static setAccuracyToHundredMeters()`

Sets accuracy to within hundred meters.

#### `static setAccuracyToKilometer()`

Sets accuracy to within one kilometer.

#### `static setAccuracyToThreeKilometers()`

Sets accuracy to within three kilometers.

#### `static reverseGeocode(latitude: number, longitude: number, locale: string):[{string: any}]`

A reverse-geocoding request fetches information about the current locati
on. The data is delivered by Apple's geocoding service.

**Return value:**
- `[{string: any}]: Promise that carries all available information about the address when resol
ved.`

---

## Mail

Sends a mail.

Presents UI for sending a mail.

### Properties

#### `toRecipients: string`

Recipients of the mail.

#### `ccRecipients: string`

Recipients to set CC on the mail.

#### `bccRecipients: string`

Recipients to set BCC on the mail.

#### `subject`

Subject of the mail.

#### `body: string`

Body of the mail.

#### `isBodyHTML`

Whether body is HTML.

#### `preferredSendingEmailAddress: string`

Preferred email address to use in the from field.

### Constructor

#### `new Mail()`

Constructs a mail.

### Methods

#### `send(): Promise`

Presents a screen from which the mail can be sent. The mail will not be 
sent until you have confirmed it from the presented screen.

**Return value:**
- `Promise: Promise that is fulfilled when the mail have been sent or saved.`

#### `addImageAttachment(image: Image)`

Adds an image attachment to the mail.

**Parameters:**
- `image` (Image): Image to add to the mail.

#### `addFileAttachment(filePath: string)`

Adds a file attachment to the mail.

#### `addDataAttachment(data: Data, mimeType: string, filename: string)`

Adds a data attachment to the mail.

---

## Message

Sends a message.

Presents UI for sending a message.

### Properties

#### `recipients: string`

Body of the message.

### Constructor

#### `new Message()`

Constructs a message to be sent either as a text message or an iMessage.

### Methods

#### `send(): Promise`

Presents a screen from which the message can be sent. The message will n
ot be sent until you have confirmed it from the presented screen.

**Return value:**
- `Promise: Promise that is fulfilled when the message have been sent.`

#### `addImageAttachment(image: Image)`

Adds an image attachment to the message.

#### `addFileAttachment(filePath: string)`

Adds a file attachment to the message.

**Parameters:**
- `filePath` (string): Path of file to add to the message.

#### `addDataAttachment(data: Data, uti: string, filename: string)`

Adds a data attachment to the message.

**Parameters:**
- `data` (Data): Data representation of file to add to the message.
- `uti` (string): UTI of file represented by the data.
- `filename` (string): Name of the file represented by the data.

---

## Pasteboard

Copy and paste strings or images.

Copy and paste strings and images to and from the pasteboard.

### Static Methods

#### `static copy(string: string)=`

Copies a string to the pasteboard.

**Parameters:**
- `string` (string): The string to copy to the pasteboard.

#### `static paste(): string`

Pastes a string from the pasteboard.

**Return value:**
- `string: String in the pasteboard or null if no string is in the pasteboard.`

#### `static copyString(string: string)`

Copies a string to the pasteboard.

**Parameters:**
- `string` (string): The string to copy to the pasteboard.

#### `static pasteString(): string`

Pastes a string from the pasteboard.

**Return value:**
- `string: String in the pasteboard or null if no string is in the pasteboard.`

#### `static pasteImage(): Image`

Pastes an image from the pasteboard.

**Return value:**
- `Image: Image in the pasteboard or null if no image is in the pasteboard.`

---

## Path

A path describes a shape.

Shapes can be descriped using a path. Use an instance of Path
to create complex shapes that can be drawn to a DrawContext.

### Constructor

#### `new Path()`

Use the methods on the path to create complex shapes.

### Methods

#### `move(point: Point)`

Moves to a point without drawing a line between the current
point and the new point.

**Parameters:**
- `point` (Point): Point to move to.

#### `addLine(point: Point)`

Add a line from the current point, e.g. set using the move method,
and to the new point.

#### `addRect(rect: Rect)`

This is a convenience function for adding a rectangle to the path starti
ng from the lower left corner and drawing the lines counter-clockwise until
 the rectangle is closed.

#### `addRoundedRect(rect: Rect, cornerWidth: number, cornerHeight: number)`

Adds a rounded rectangle to the path. The corner width specifies the hor
izontal size of the corner and the corner height specifies the the vertical
 size of the corner.

#### `addCurve(point: Point, control1: Point, control2:Point)`

Adds a cubic Bezier curve to the path with the specified end point and c
ontrol points.

#### `addQuadCurve(point: Point, control: Point)`

Adds a quadratic Bezier curve to the specified end point with the specif
ied control point.

#### `addLines(points: [Point])`

Adds straight lines between an array of points. Calling this method is e
quivalent to calling the move function with the first point in the array of
 points and then calling addLine on the subsequent points in the array.

#### `addRects(rects: [Rect])`

Calling this is equivalent to repeatedly calling addRect.

#### `closeSubpath()`

Adds a straight line from the current point to the start of the current 
subpath.

---

## Point

Structure representing a point.

The structure encapsulates a coordinate in a two-dimensional coordinate 
system.

### Properties

#### `x: nu
mber`

X value.

#### `y: nu
mber`

Y value.

---

## Rect

Structure representing a rectangle.

The structure has a width, height and a coordinate in a two-dimensional 
coordinate system.

### Properties

#### `minX: number`

Minimum X value.

*Read-only.*

#### `minY: number`

Minimum Y value.

*Read-only.*

#### `maxX: number`

Maximum X value.

*Read-only.*

#### `maxY: number`

Maximum Y value.

*Read-only.*

#### `x: nu
mber`

X value.

#### `y: nu
mber`

Y value.

#### `width: number`

Width of rectangle.

#### `height`

Height of rectangle.

#### `origin`

Point that specifies the rectangles origin.

#### `size: Size`

Size of the rectangle.

### Constructor

#### `new Rect(x: number, y: number, width: number, height: number)`

Constructs a new rectangle placed in a two-dimensional coordinate system
.

**Parameters:**
- `x` (number): X coordinate.
- `y` (number): Y coordinate.
- `width` (number): Width of rectangle.
- `height` (number): Height of rectangle.

---

## Size

Structure representing a size.

The structure has a width and a height to specify a two-dimensional size
.

### Properties

#### `width: number`

Width value.

#### `height`

Height value.

### Constructor

#### `new Size(width: number, height: number)`

Constructs a new size.

**Parameters:**
- `width` (number): Width value.
- `height` (number): Height value.

---

## Photos

Provides access to your photo library.

### Static Methods

#### `static fromLibrary(): Promise<Image>`

Use this for picking an image from the photo library.

#### `static latestPhoto(): Promise<Image>`

Reads the latest photo from your photo library. If no photo is available
, the promise will be rejected.

#### `static latestPhotos(count: number): Promise<[Image]>`

Reads the latests photos from your photo library. If no photo is availab
le, the promise will be rejected.

**Return value:**
- `Promise<[Image]>: Promise that provides the photos when fulfilled.`

#### `static latestScreenshot(): Promise<Image>`

Reads the latest screenshot from your photo library. If no screenshot is
 available, the promise will be rejected.

#### `static latestScreenshots(count: number): Promise<[Image]>`

Reads the latests screenshots from your photo library. If no screenshot 
is available, the promise will be rejected.

**Parameters:**
- `count` (number): Number of screenshots to fetch.

**Return value:**
- `Promise<[Image]>: Promise that provides the screenshots when fulfilled.`

#### `static removeLatestPhoto()`

Before removing the photo, an alert is shown prompting you to confirm th
e removal.

#### `static removeLatestPhotos(count: number)`

Before removing the photos, an alert is shown prompting you to confirm t
he removal.

**Parameters:**
- `count` (number): Number of photos to remove.

#### `static removeLatestScreenshot()`

Before removing the screenshot, an alert is shown prompting you to confi
rm the removal.

#### `static removeLatestScreenshots(count: number)`

Before removing the screenshots, an alert is shown prompting you to conf
irm the removal.

**Parameters:**
- `count` (number): Number of screenshots to remove.

#### `static save(image: Image)`

Saves the image to the photo library.

**Parameters:**
- `image` (Image): The image to save.

---

## QuickLook

### Static Methods

#### `static present(item: any, fullscreen: bool): Promise`

Chooses the best suited presentation of the item and performs
the presentation if possible.

**Parameters:**
- `item` (any): Item to be present.
- `fullscreen` (bool): Optional. Set to true to present the item in fullscreen. This only has an e
ffect when used within the app. Defaults to false.

**Return value:**
- `Promise: Promise that is fulfilled when the quick look is dismissed.`

---

## RecurrenceRule

Recurrence rule used with reminders and calendar events.

A recurrence rule specifies how often a reminder or a calendar event sho
uld repeat.

### Static Methods

#### `static daily(interval:number): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every day and a value of 3 specifies that the rule should rep
eat every third day.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static dailyEndDate(interval: number, endDate: Date): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every day and a value of 3 specifies that the rule should rep
eat every third day.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `endDate` (Date): Date at which the recurrence rule should end.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static dailyOccurrenceCount(interval: number, occurrenceCount: number): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every day and a value of 3 specifies that the rule should rep
eat every third day.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `occurrenceCount` (number): Number of times the rule should repeat before it ends.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static weekly(interval:number): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every week and a value of 3 specifies that the rule should re
peat every third week.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static weeklyEndDate(interval:number, endDate: Date): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every week and a value of 3 specifies that the rule should re
peat every third week.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `endDate` (Date): Date at which the recurrence rule should end.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static weeklyOccurrenceCount(interval: number, occurrenceCount: number): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every week and a value of 3 specifies that the rule should re
peat every third week.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `occurrenceCount` (number): Number of times the rule should repeat before it ends.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static monthlyEndDate(interval: number, endDate: Date): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every month and a value of 3 specifies that the rule should r
epeat every third month.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `endDate` (Date): Date at which the recurrence rule should end.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static monthlyOccurrenceCount(interval: number, occurrenceCount: number): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every month and a value of 3 specifies that the rule should r
epeat every third month.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `occurrenceCount` (number): Number of times the rule should repeat before it ends.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static yearly(interval:number): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every year and a value of 3 specifies that the rule should re
peat every third year.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static yearlyEndDate(interval:number, endDate: Date): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every year and a value of 3 specifies that the rule should re
peat every third year.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `endDate` (Date): Date at which the recurrence rule should end.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static yearlyOccurrenceCount(interval: number, occurrenceCount: number): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every year and a value of 3 specifies that the rule should re
peat every third year.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `occurrenceCount` (number): Number of times the rule should repeat before it ends.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static complexWeekly(interval: number, daysOfTheWeek: [number], setPositions: [number]): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every week and a value of 3 specifies that the rule should re
peat every third week.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `daysOfTheWeek` ([number]): Days of the week to repeat the rule. Values range from 1 to 7, with Sunday 
being 1.
- `setPositions` ([number]): Filters which recurrences to include in the rule's frequency.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static complexWeeklyEndDate(interval: number, daysOfTheWeek: [number], setPositions: [number], endDate: Date): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every week and a value of 3 specifies that the rule should re
peat every third week.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `daysOfTheWeek` ([number]): Days of the week to repeat the rule. Values range from 1 to 7, with Sunday 
being 1.
- `setPositions` ([number]): Filters which recurrences to include in the rule's frequency.
- `endDate` (Date): Date at which the recurrence rule should end.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static complexWeeklyOccurrenceCount(interval: number, daysOfTheWeek: [number], setPositions: [number], occurrenceCount: number): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every week and a value of 3 specifies that the rule should re
peat every third week.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `daysOfTheWeek` ([number]): Days of the week to repeat the rule. Values range from 1 to 7, with Sunday 
being 1.
- `setPositions` ([number]): Filters which recurrences to include in the rule's frequency.
- `occurrenceCount` (number): Number of times the rule should repeat before it ends.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static complexMonthly(interval: number, daysOfTheWeek: [number], daysOfTheMonth: [number], setPositions: [number]): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every month and a value of 3 specifies that the rule should r
epeat every third month.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `daysOfTheWeek` ([number]): Days of the week to repeat the rule. Values range from 1 to 7, with Sunday 
being 1.
- `daysOfTheMonth` ([number]): Days of the month to repeat the rule. Values range from 1 to 31 and from -1
 to -31.
- `setPositions` ([number]): Filters which recurrences to include in the rule's frequency.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static complexMonthlyEndDate(interval: number, daysOfTheWeek: [number], daysOfTheMonth: [number], setPositions: [number], endDate: Date): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every month and a value of 3 specifies that the rule should r
epeat every third month.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `daysOfTheWeek` ([number]): Days of the week to repeat the rule. Values range from 1 to 7, with Sunday 
being 1.
- `daysOfTheMonth` ([number]): Days of the month to repeat the rule. Values range from 1 to 31 and from -1
 to -31.
- `setPositions` ([number]): Filters which recurrences to include in the rule's frequency.
- `endDate` (Date): Date at which the recurrence rule should end.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static complexMonthlyOccurrenceCount(interval: number, daysOfTheWeek: [number], daysOfTheMonth: [number], setPositions: [number], occurrenceCount: number): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every month and a value of 3 specifies that the rule should r
epeat every third month.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `daysOfTheWeek` ([number]): Days of the week to repeat the rule. Values range from 1 to 7, with Sunday 
being 1.
- `daysOfTheMonth` ([number]): Days of the month to repeat the rule. Values range from 1 to 31 and from -1
 to -31.
- `setPositions` ([number]): Filters which recurrences to include in the rule's frequency.
- `occurrenceCount` (number): Number of times the rule should repeat before it ends.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static complexYearly(interval: number, daysOfTheWeek: [number], monthsOfTheYear: [number], weeksOfTheYear: [number], daysOfTheYear: [number], setPositions: [number]): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every year and a value of 3 specifies that the rule should re
peat every third year.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `daysOfTheWeek` ([number]): Days of the week to repeat the rule. Values range from 1 to 7, with Sunday 
being 1.
- `monthsOfTheYear` ([number]): The months of the year to repeat the rule. Values range from 1 to 12.
- `weeksOfTheYear` ([number]): The weeks of the year to repeat the rule. Values range from 1 to 53 and -1 
to -53.
- `daysOfTheYear` ([number]): The days of the year to repeat the rule. Values range from 1 to 366 and -1 
to -366.
- `setPositions` ([number]): Filters which recurrences to include in the rule's frequency.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static complexYearlyEndDate(interval: number, daysOfTheWeek: [number], monthsOfTheYear: [number], weeksOfTheYear: [number], daysOfTheYear: [number], setPositions: [number], endDate: Date): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every year and a value of 3 specifies that the rule should re
peat every third week.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `daysOfTheWeek` ([number]): Days of the week to repeat the rule. Values range from 1 to 7, with Sunday 
being 1.
- `monthsOfTheYear` ([number]): The months of the year to repeat the rule. Values range from 1 to 12.
- `weeksOfTheYear` ([number]): The weeks of the year to repeat the rule. Values range from 1 to 53 and -1 
to -53.
- `daysOfTheYear` ([number]): The days of the year to repeat the rule. Values range from 1 to 366 and -1 
to -366.
- `setPositions` ([number]): Filters which recurrences to include in the rule's frequency.
- `endDate` (Date): Date at which the recurrence rule should end.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

#### `static complexYearlyOccurrenceCount(interval: number, daysOfTheWeek: [number], monthsOfTheYear: [number], weeksOfTheYear: [number],daysOfTheYear: [number], setPositions: [number], occurrenceCount: number): RecurrenceRule`

The interval should have a value greater than 0 and specifies how often 
the pattern repeats. For example, an interval of 1 specifies that the rule 
should repeat every year and a value of 3 specifies that the rule should re
peat every third year.

**Parameters:**
- `interval` (number): Interval at which to repeat the rule.
- `daysOfTheWeek` ([number]): Days of the week to repeat the rule. Values range from 1 to 7, with Sunday 
being 1.
- `monthsOfTheYear` ([number]): The months of the year to repeat the rule. Values range from 1 to 12.
- `weeksOfTheYear` ([number]): The weeks of the year to repeat the rule. Values range from 1 to 53 and -1 
to -53.
- `daysOfTheYear` ([number]): The days of the year to repeat the rule. Values range from 1 to 366 and -1 
to -366.
- `setPositions` ([number]): Filters which recurrences to include in the rule's frequency.
- `occurrenceCount` (number): Number of times the rule should repeat before it ends.

**Return value:**
- `RecurrenceRule: Constructed recurrence rule.`

---

## Reminder

Manages reminders in calendars.

### Properties

#### `identifier: string`

Title of reminder.

#### `notes: string`

Notes associated with reminder.

#### `isCompleted`

Whether the reminder is completed.

#### `isOverdue`

Priority of reminder.

#### `dueDate`

Due date of reminder.

#### `dueDateIncludesTime`

Whether the due date includes a time.

#### `completionDate`

Completion date of reminder.

*Read-only.*

#### `creationDate`

Creation date of reminder.

*Read-only.*

#### `calendar`

Calendar the reminder is stored in.

### Constructor

#### `new Reminder()`

In order to add the reminder to your calendar, you must call the save() 
function.

### Static Methods

#### `static all(calendars: [Calendar]): Promise<[Reminder]>`

For performance reasons iOS limits fetched results to events within a fo
ur year timespan.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static allCompleted(calendars:[Calendar]): Promise&lt;[Reminder]>`

For performance reasons iOS limits fetched results to events within a fo
ur year timespan.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static allIncomplete(calendars: [Calendar]): Promise&lt;[Reminder]>`

For performance reasons iOS limits fetched results to events within a fo
ur year timespan.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static allDueToday(calendars: [Calendar]): Promise<;[Reminder]>`

Fetches all reminders due today.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static completedDueToday(calendars: [Calendar]): Promise<[Reminder]>`

Fetches completed reminders due today.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static incompleteDueToday(calendars: [Calendar]): Promise<[Reminder]>`

Fetches incomplete reminders due today.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static allDueTomorrow(calendars: [Calendar]): Promise<[Reminder]>`

Fetches all reminders due tomorrow.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static completedDueTomorrow(calendars: [Calendar]): Promise<[Reminder]>`

Fetches completed reminders due tomorrow.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static incompleteDueTomorrow(calendars: [Calendar]): Promise<[Reminder]>`

Fetches incomplete reminders due tomorrow.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static allDueYesterday(calendars: [Calendar]): Promise<[Reminder]>`

Fetches all reminders due yesterday.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static completedDueYesterday(calendars: [Calendar]): Promise<[Reminder]>`

Fetches completed reminders due yesterday.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static incompleteDueYesterday(calendars: [Calendar]): Promise<[Reminder]>`

Fetches incomplete reminders due yesterday.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static allDueThisWeek(calendars: [Calendar]): Promise<[Reminder]>`

Fetches all reminders due this week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static completedDueThisWeek(calendars: [Calendar]): Promise<[Reminder]>`

Fetches completed reminders due this week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static incompleteDueThisWeek(calendars: [Calendar]): Promise<[Reminder]>`

Fetches incomplete reminders due this week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static allDueNextWeek(calendars: [Calendar]): Promise<[Reminder]>`

Fetches all reminders due next week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static completedDueNextWeek(calendars: [Calendar]): Promise<[Reminder]>`

Fetches completed reminders due next week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static incompleteDueNextWeek(calendars: [Calendar]): Promise<[Reminder]>`

Fetches incomplete reminders due next week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static allDueLastWeek(calendars: [Calendar]): Promise<[Reminder]>`

Fetches all reminders due last week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static completedDueLastWeek(calendars: [Calendar]): Promise<[Reminder]>`

Fetches completed reminders due last week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static incompleteDueLastWeek(calendars: [Calendar]): Promise<[Reminder]>`

Fetches incomplete reminders due last week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static completedToday(calendars: [Calendar]): Promise<[Reminder]>`

Note that this does not take the due date into account. This will return
 all reminders that you have completed today.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static completedThisWeek(calendars: [Calendar]): Promise<[Reminder]>`

Note that this does not take the due date into account. This will return
 all reminders that you have completed this week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static completedLastWeek(calendars: [Calendar]): Promise<[Reminder]>`

Note that this does not take the due date into account. This will return
 all reminders that you have completed last week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static allDueBetween(startDate: Date, endDate: Date, calendars: [Calendar]): Promise<[Reminder]>`

Fetches reminders that are due within the time interval constituted by
the start and end dates.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static completedDueBetween(startDate: Date, endDate: Date, calendars: [Calendar]): Promise<[Reminder]>`

Fetches reminders that are completed and that were due within the time i
nterval constituted by the start and end dates.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static incompleteDueBetween(startDate: Date, endDate: Date, calendars: [Calendar]): Promise<[Reminder]>`

Fetches reminders that are incomplete and that were due within the time 
interval constituted by the start and end dates.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

#### `static completedBetween(startDate: Date, endDate: Date, calendars: [Calendar]): Promise<[Reminder]>`

Fetches reminders that were completed within the time interval constitut
ed by the start and end dates.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch reminders for. Defaults to all calendars.

**Return value:**
- `Promise<[Reminder]>: Promise that provides the reminders when fulfilled.`

### Methods

#### `addRecurrenceRule(recurrenceRule: RecurrenceRule)`

Recurrence rules specify when the reminder should be repeated. See the d
ocumentation of RecurrenceRule for more information on creating rules.

#### `removeAllRecurrenceRules()`

Removes all recurrence rules.

#### `save()`

Saves changes to a reminder, inserting it into the calendar if it is new
ly created.

#### `remove()`

Removes reminder from calendar.

---

## RelativeDateTimeFormatter

Creates a textual representation of the amount of time between two dates
.

The relative date formatter takes two dates as input and creates a textu
al representation that communicates the relative time between the two dates
, e.g. "yesterday" and "in 1 week".

### Properties

#### `locale`

Locale to use when formatting.

### Constructor

#### `new RelativeDateTimeFormatter()`

The formatter creates a textual representation of the time between two p
oints in time.

### Methods

#### `string(date: Date, referenceDate: Date): string`

Creates a localized textual representation of the amount of time between
 to dates. If the two dates are the same, the function will return "now". I
f the reference date is yesterday, the function will return "yesterday". Ot
her examples include "in 10 seconds", "2 hours ago", "last week" and "next 
year".

**Parameters:**
- `date` (Date): The date to create a relative date and time for.

**Return value:**
- `string: A textual representation of the amount of time between the two dates.`

#### `useNamedDateTimeStyle()`

When using the named style, the formatter tries to find a suitable textu
al representation over a numeric value for the relative time, e.g. "now" in
stead of "in 0 seconds" and "yesterday" instead of "1 day ago".

#### `useNumericDateTimeStyle()`

When using the numeric style, the formatter will always prefer numeric r
epresentations over named representations. E.g. it will return "in 0 second
s" instead of "now" and "1 day ago" instead of "yesteday".

---

## Safari

Presents a website.

Presents a website either in-app or by leaving the app an opening the Sa
fari app.

### Static Methods

#### `static openInApp(url: string,fullscreen: bool): Promise`

Presents a website without leaving the app.

#### `static open(url: string)`

Presents a website in the Safari app, thus leaving the current app.

**Parameters:**
- `url` (string): URL of website to present.

---

## Script

Access information about the script.

Allows for accessing information about the script that is currently bein
g run and controlling selected parts of the script execution.

### Static Methods

#### `static name(): string`

Name of the script.

#### `static complete()`

Call this function to inform the system that the script has completed ru
nning.

#### `static setShortcutOutput(value: any)`

Use this function to pass values to other actions in the Shortcuts app. 
The output can be a text, a number, a boolean, a dictionary or a file path 
pointing to a file stored in iCloud.

#### `static setWidget(widget: any)=`

Sets the widget to be displayed.

**Parameters:**
- `widget` (any): Widget to display.

---

## SFSymbol

Representation of a SF symbol.

SF symbols are Apple's configurable icons that are designed to look grea
t with the San Francisco font.

### Properties

#### `image: Image`

Convert the symbol to an image.

*Read-only.*

### Static Methods

#### `static named(symbolName: string): SFSymbol`

SF symbols are Apple's configurable icons that are designed to look grea
t with the San Francisco font.

**Return value:**
- `SFSymbol: Constructed SF symbol or null if no symbol with the name exists.`

### Methods

#### `applyUltraLightWeight()`

Configures the symbol to use an ultra light weight.

#### `applyThinWeight()`

Configures the symbol to use an thin weight.

#### `applyLightWeight()`

Configures the symbol to use an light weight.

#### `applyRegularWeight()`

Configures the symbol to use an regular weight.

#### `applyMediumWeight()`

Configures the symbol to use an medium weight.

#### `applySemiboldWeight()`

Configures the symbol to use an semibold weight.

#### `applyBoldWeight()`

Configures the symbol to use an bold weight.

#### `applyHeavyWeight()`

Configures the symbol to use an heavy weight.

#### `applyBlackWeight()`

Configures the symbol to use an black weight.

---

## ShareSheet

Offers standard activities to perform on items.

The activity picker presents activities that can be performed on a set o
f items. For example sending an item via an email or SMS, saving an item to
 disk or opening
an item in a third party app.
Available activites vary depending on the provided items.

### Static Methods

#### `static present(activityItems: [any]): Promise<{string: any}>`

Presents a share sheet with an array of items to share. The activities i
ncluded in the presented sheet will vary based
on the type of item.

**Parameters:**
- `activityItems` ([any]): Items to perform activity on.

**Return value:**
- `Promise<{string: any}>: Promise carrying a value that tells which activity that was performed, if a
ny. The promise is fulfilled when the sheet is dismissed.`

---

## Speech

Speaks a text.

If used in a script triggered by a Siri Shortcut, Siri will speak the te
xt.

### Static Methods

#### `static speak(text: string)`

Speaks a text.

---

## TextField

### Properties

#### `text: string`

Text in the text field.

#### `placeholder`

Placeholder shown in the text field while it is empty.

#### `isSecure`

Hides the text that is entered when set to true.

#### `textColor: Font`

Font of the text.

### Methods

#### `setDefaultKeyboard()`

Use the default keyboard for entering text.

#### `setNumberPadKeyboard()`

Use a keyboard that prominently features the numbers 0 through 9.

#### `setDecimalPadKeyboard()`

Use a numeric keyboard with a decimal point for entering text.

#### `setNumbersAndPunctuationKeyboard()`

Use a numeric keyboard with punctuation for entering text.

#### `setPhonePadKeyboard()`

Use a keyboard that prominently feaetures the numbers 0 through 9 and th
e * and # characters.

#### `setWebSearchKeyboard()`

Use a keyboard that prominently features the space and period characters
.

#### `setEmailAddressKeyboard()`

Use a keyboard that prominently features the @, period and space charact
ers.

#### `setURLKeyboard()`

Use a keyboard that prominently faetures the period and slash characters
 and the ".com" string.

#### `setTwitterKeyboard()`

Use a keyboard that prominently features the @ and # characters.

#### `leftAlignText()`

This is the default text alignment.

#### `centerAlignText()`

Center aligns the text.

#### `rightAlignText()`

Right aligns the text.

---

## UITable

Renders a table.

Tables present data in a structured manner. A table contains rows which 
in turn contains cells.

### Properties

#### `showSeparators`

Whether to show separators.

### Constructor

#### `new UITable()`

Use a table to present data in a structured manner.

### Methods

#### `addRow(row: UITableRow)`

Adds a row.

#### `removeAllRows()`

Removes all rows.

#### `reload()`

If you add or remove rows while a table view is presented, you must relo
ad the table in order for the changes to take effect.

#### `present(fullscreen: bool): Promise`

Presents the table.

**Parameters:**
- `fullscreen` (bool): Optional. Set to true to present the web view in fullscreen. This only has 
an effect when used within the app. Defaults to false.

**Return value:**
- `Promise: Promise that is fulfilled when the table is dismissed.`

---

## UITableCell

Cell in a UITableRow.

Cells are shown horizontally in a UITableRow which in turn is shown
vertically in a UITable. Cells have content, e.g. a text or an image.

### Properties

#### `widthWeight`

Relative width of the cell.

#### `onTap: fn()`

Called when the button is tapped.

#### `dismissOnTap`

Whether to dismiss the table when the button is tapped.

#### `titleColor`

Color of the title.

#### `subtitleColor`

Color of the subtitle.

#### `titleFont`

Font of the subtitle.

### Static Methods

#### `static text(title: string, subtitle: string): UITableCell`

Constructs a new cell containing text.

**Parameters:**
- `title` (string): Optional title to show in the cell.
- `subtitle` (string): Optional subtitle shown below the title.

**Return value:**
- `UITableCell: Constructed cell.`

#### `static image(image: Image): UITableCell`

Constructs a new cell containing an image.

**Parameters:**
- `image` (Image): Image to show in the cell.

**Return value:**
- `UITableCell: Constructed cell.`

#### `static imageAtURL(url: string): UITableCell`

Constructs a new cell that loads the image at the specified URL.

**Parameters:**
- `url` (string): URL to image.

**Return value:**
- `UITableCell: Constructed cell.`

#### `static button(title: string): UITableCell`

Constructs a button cell.

**Parameters:**
- `title` (string): Title of the button.

**Return value:**
- `UITableCell: Constructed cell.`

### Methods

#### `leftAligned()`

Specifies that content in the cell should be left aligned.

#### `centerAligned()`

Specifies that content in the cell should be center aligned.

#### `rightAligned()`

Specifies that content in the cell should be right aligned.

---

## UITableRow

Row in a UITable.

Rows can be added to an instance of UITable. A row is shown vertically
in a UITable in the order they are added to the table. Rows contain cells w
hich are shown horizontally in the order they are added to the row.

### Properties

#### `cellSpacing`

Spacing between cells.

#### `height`

Height of the row.

#### `isHeader`

Whether the cell is a header.

#### `dismissOnSelect`

Whether to dismiss the table when the row is selected.

#### `onSelect`

Called when the row is selected.

#### `backgroundColor`

Background color.

### Constructor

#### `new UITableRow()`

Rows are shown vertically in a UITable. A row contains cells which are d
isplayed horizontally.

### Methods

#### `addCell(cell: UITableCell)`

Adds a cell to the row. Note that cells are shown in the order they are 
added to the row.

**Parameters:**
- `cell` (UITableCell): Cell to add to the row.

#### `addText(title: string, subtitle: string): UITableCell`

Constructs a new cell containing the specified string and adds it to the
 row.

**Parameters:**
- `title` (string): Optional title to show in the cell.
- `subtitle` (string): Optional subtitle shown below the title in the cell.

**Return value:**
- `UITableCell: Constructed cell.`

#### `addImageAtURL(url: string): UITableCell`

Constructs a new cell that loads the image at the specified url and adds
 the cell to the row.

**Parameters:**
- `url` (string): URL to image.

**Return value:**
- `UITableCell: Cosntructed cell.`

#### `addButton(title: string): UITableCell`

Adds a button cell.

**Parameters:**
- `title` (string): Title of the button.

**Return value:**
- `UITableCell: Cosntructed cell.`

---

## URLScheme

### Static Methods

#### `static allParameters(): {string: string}`

Gets all the query parameters that were passed in the URL when running t
his script by invoking its URL scheme.

**Return value:**
- `{string: string}: All query parameters.`

#### `static forOpeningScript(): string`

URL for opening the script.

**Return value:**
- `string: URL for opening script.`

#### `static forOpeningScriptSettings(): string`

Gets the URL for opening the settings of the current script. When making
 a request to the returned URL from another app, e.g. Safari, the settings 
of the current script will be opened.

**Return value:**
- `string: URL for opening script settings.`

#### `static forRunningScript(): string`

URL for running script.

**Return value:**
- `string: URL for opening script settings.`

---

## UUID

Unique identifier.

A universally unique value that can be used to identify items.

### Static Methods

#### `static string(): string`

Used for getting the string value of a UUID.

**Return value:**
- `string: String value.`

---

## XMLParser

### Properties

#### `didStartDocument`

Function called when the parser begins parsing a document.

#### `didEndDocument`

Function called when the parser ends parsing a document.

#### `didStartElement: string`

Function called when starting to parse an element.

#### `didEndElement`

Function called when ended parsing an element.

#### `foundCharacters`

Function called when the parser finds characters of an element.

#### `parseErrorOccurred`

Function called when the parser encounters an error.

#### `string`

XML string to be parsed.

### Constructor

#### `new XMLParser(string: string)`

Constructs an event driven XML parser. It does not do any parsing on its
 own and therefore the callback functions must be set before starting to pa
rse.

**Parameters:**
- `string` (string): XML string to be parsed.

### Methods

#### `parse(): bool`

Before calling this function you should ensure that the parser is correc
tly configured, i.e. the necessary callback functions should be set.

**Return value:**
- `bool: Whether parsing was successfully started.`

---

## WidgetDate

Date element shown in a widget.

A date shown in a widget. Dates will update periodically when shown in a
 widget.

### Properties

#### `date: Date`

Date to show in a widget.

#### `textColor: Font`

Font and text size of the text.

#### `textOpacity`

Opacity of the text.

#### `lineLimit`

Minimum amount the text scales down to.

#### `shadowColor`

Color of the shadow.

#### `shadowRadius`

Size of the shadow.

#### `shadowOffset`

Offset of the shadow.

#### `url`

URL to open.

### Methods

#### `leftAlignText()`

Specifies that text should be left aligned. This is the default.

#### `centerAlignText()`

Specifies that text should be center aligned.

#### `rightAlignText()`

Specifies that text should be right aligned.

#### `applyTimeStyle()`

Example output:
    11:23PM

#### `applyDateStyle()`

Example output:
    June 3, 2019

#### `applyRelativeStyle()`

Example output:
    2 hours, 23 minutes
    1 year, 1 month

#### `applyOffsetStyle()`

Example output:
    +2 hours
    -3 months

#### `applyTimerStyle()`

Example output:
   2:32
   36:59:01

---

## WidgetImage

Image element shown in widget.

### Properties

#### `image: Image`

Image to show in widget.

#### `resizable`

Opacity when shown in widget.

#### `cornerRadius`

Radius of the corners.

#### `borderWidth`

Border width.

#### `borderColor`

Border color.

#### `containerRelativeShape: bool`

Shape the image relative to its container.

#### `tintColor`

URL to open.

### Methods

#### `leftAlignImage()`

Specifies that image should be left aligned. This is the default.

#### `centerAlignImage()`

Specifies that image should be center aligned.

#### `rightAlignImage()`

Specifies that image should be right aligned.

#### `applyFittingContentMode()`

The image will fit the available space. This content mode is the default
.

#### `applyFillingContentMode()`

The image will fill the available space.

---

## WidgetSpacer

Spacer element shown in widget.

Shows a spacer in the widget. A spacer with a null length has a flexible
 length.

### Properties

#### `length`

Text to show in widget.

---

## WidgetStack

Stack element shown in widget.

Shows a stack in the widget.

### Properties

#### `backgroundColor`

Background color of the widget.

#### `backgroundImage`

Background image.

#### `backgroundGradient`

Background gradient.

#### `spacing`

Spacing between elements.

#### `size: Size`

Size of the stack.

#### `cornerRadius`

Radius of the corners.

#### `borderWidth`

Border width.

#### `borderColor`

Border color.

#### `url`

URL to open.

### Methods

#### `addSpacer(length: number): WidgetSpacer`

Adds a spacer to the stack. This can be used to offset the content horiz
ontally in the stack.

**Return value:**
- `WidgetSpacer: Spacer element.`

#### `setPadding(top: number, leading: number, bottom: number, trailing: number)`

Sets the padding on each side of the stack.

**Parameters:**
- `top` (number): Padding on the top edge.
- `leading` (number): Padding on the leading edge.
- `bottom` (number): Padding on the bottom edge.
- `trailing` (number): Padding on the trailing edge.

#### `useDefaultPadding()`

Use the default padding.

#### `topAlignContent()`

Specifies that content should be top aligned. This is the default.

#### `centerAlignContent()`

Specifies that content should be center aligned.

#### `bottomAlignContent()`

Specifies that content should be bottom aligned.

#### `layoutHorizontally()`

Specifies that the stack should layout elements horizontally. This is th
e default.

#### `layoutVertically()`

Specifies that the stack should layout elements vertically.

---

## WidgetText

Text element shown in a widget.

### Properties

#### `text: string`

Text to show in a widget.

#### `textColor: Font`

Font and text size of the text.

#### `textOpacity`

Opacity of the text.

#### `lineLimit`

Minimum amount the text scales down to.

#### `shadowColor`

Color of the shadow.

#### `shadowRadius`

Size of the shadow.

#### `shadowOffset`

Offset of the shadow.

#### `url`

URL to open.

### Methods

#### `leftAlignText()`

Specifies that text should be left aligned. This is the default.

#### `centerAlignText()`

Specifies that text should be center aligned.

#### `rightAlignText()`

Specifies that text should be right aligned.

---

## LinearGradient

Linear gradient.

A linear gradient to be used in a widget.

### Properties

#### `colors: Color`

Colors of the gradient.

#### `locations: number`

Locations of each color.

#### `startPoint`

Point to start the gradient.

#### `endPoint`

Constructs a linear gradient.

---

## args

Arguments passed to the script.

Arguments are passed to the script when the script is executed from a sh
are sheet. You can specify the types of arguments a script supports from th
e script settings.

### Properties

#### `length`

Number of arguments supplied by a share sheet.

*Read-only.*

#### `all: [
any]`

All arguments supplied by a share sheet.

*Read-only.*

#### `plainTexts: string`

Plain texts supplied by a share sheet or a shortcut action.

*Read-only.*

#### `urls: 
[string]`

URLs supplied by a share sheet or a shortcut action.

*Read-only.*

#### `fileURLs: string`

File URLs supplied by a share sheet or a shortcut action.

*Read-only.*

#### `images: Image`

Images supplied by a share sheet or a shortcut action.

*Read-only.*

#### `queryParameters: string`

Query parameters from a URL scheme.

*Read-only.*

#### `siriShortcutArguments: string`

Arguments passed from a Siri Shortcut.

*Read-only.*

#### `shortcutParameter`

Parameter passed to a Shortcut.

*Read-only.*

#### `widgetParameter`

Parameter passed to a widget.

*Read-only.*

#### `notification`

Notification being handled by the script.

*Read-only.*

---

## config

Configuration the script runs with.

Contains information about the configuration the script is currently bei
ng run under.

### Properties

#### `runsInApp`

Whether the script is running in the app.

*Read-only.*

#### `runsInActionExtension`

Whether the script is running in the action extension.

*Read-only.*

#### `runsWithSiri`

Whether the script is running with Siri.

*Read-only.*

#### `runsInWidget`

Whether the script is running in a widget.

*Read-only.*

#### `runsInAccessoryWidget`

Whether the script is running in a widget.

*Read-only.*

#### `runsInNotification`

Whether the script is running in a notification.

*Read-only.*

#### `runsFromHomeScreen`

Whether the script was run from the home screen. You can add a script to
 the home screen from the script settings.

*Read-only.*

#### `widgetFamily`

The size of the widget the script is running in.

*Read-only.*

---

## console

Adds messages to the log.

The console can be used to log information when running your script. The
 log may be useful when debugging your script, e.g. to examine values of va
riables.

### Static Methods

#### `static log(message: any)`

Logs a message to the console.

#### `static warn(message: any)`

Logs a warning message to the console.

**Parameters:**
- `message` (any): Message to log to the console.

#### `static error(message: any)`

Logs an error message to the console.

**Parameters:**
- `message` (any): Message to log to the console.

#### `static logError(message: any)=`

Logs an error message to the console.

**Parameters:**
- `message` (any): Message to log to the console.

---

## importModule

Consider the following file.

### Properties

#### `Parameters`

---

## module

The current module.

### Properties

#### `filename`

Path to file containing the module.

*Read-only.*

#### `exports`

Exported functions and modules.

---

## 

### Properties

#### `JavaScript Environment`

#### `Learning JavaScript`

Note that some guides and tutorials will assume that you're running Java
Script in a browser and therefore have access to browser specific objects, 
such as a document. Scriptable does not run JavaScript in a browser and the
refore such objects do not exist.

#### `Community`

---

